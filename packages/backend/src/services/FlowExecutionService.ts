import {
  Conversation,
  Lead,
  Flow,
  PaymentIntent,
  Order,
  Cart,
  PricingService,
  parseCurrencyToCentavos,
  type ConversationPhase,
  type FlowRepository,
  type ConversationRepository,
  type LeadRepository,
  type ConversationEventRepository,
  type PaymentIntentRepository,
  type ProductRepository,
  type OrderRepository,
  type PackageOfferRepository,
  type MessagingPort,
  type FlowNode,
  type AIResponseNodeData,
  type TextNodeData,
  type ImageNodeData,
  type ConditionNodeData,
  type CaptureNodeData,
  type WebhookNodeData,
  type DelayNodeData,
  type TriggerNodeData,
  type DistributorNodeData,
  type NotificationNodeData,
  type PixelNodeData,
  type PixNodeData,
  type LabelNodeData,
  type TagLeadNodeData,
  type PaymentConfirmedNodeData,
  type AIValidateReceiptNodeData,
  type CatalogSearchNodeData,
  type CartAddNodeData,
  type CartSummaryNodeData,
  type CheckoutNodeData,
  type PackagePixNodeData,
  type ClassifyIntentNodeData,
  type DeliverTitleNodeData,
  type HandoffRequestNodeData,
  Handoff,
  type HandoffRepository,
  type HandoffReason,
  type Bot,
  type ConversationSnapshot,
  type CartItem,
} from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'
import { buildPixBrCode } from './pixBrCode.js'
import { mkdirSync, writeFileSync } from 'fs'
import { join as joinPath } from 'path'

// Comprovantes aprovados: 1 arquivo por PaymentIntent (pedido) — nunca públicos,
// servidos só pela rota autenticada /api/receipts/:botId/:intentId.
export const RECEIPTS_DIR = process.env.RECEIPTS_DIR ?? joinPath(process.cwd(), '..', '..', 'receipts')
import type { PaymentOrchestrator } from '../payment/PaymentOrchestrator.js'
import type { CatalogSearchService } from './CatalogSearchService.js'
import { EscapeHatchService, type EscapeRoute } from './EscapeHatchService.js'
import type { VisionTitleExtractor } from './VisionTitleExtractor.js'
import type { DeliveryService } from './DeliveryService.js'
import type { ContextualAIRouter } from './ContextualAIRouter.js'
import type { PaymentPhaseRouter } from './PaymentPhaseRouter.js'
import type { CapabilityRouter } from './CapabilityRouter.js'
import type { AIObservationRepository } from '@whatsbot/core'
import type { ConversationOutcomeRepository, ConversationOutcomeType } from '@whatsbot/core'
import { deriveTerminalOutcome } from '@whatsbot/core'
import { buildBotPersona } from './BotPersonaBuilder.js'

const RECOVERY_THRESHOLD = 0.6

// Structured diagnostic logger — prefix every line with [FES] for easy grep
function flog(area: string, data: Record<string, unknown>): void {
  const parts = Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
  console.log(`[FES:${area}] ${parts}`)
}

// Simple hash for message dedup detection
function msgHash(s: string): string {
  let h = 0
  for (let i = 0; i < Math.min(s.length, 200); i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

// pushName do WhatsApp → primeiro nome utilizável em saudação. O pushName é controlado
// pelo CONTATO (emoji, título, nome de loja, "." etc), então só aceita um token alfabético
// curto; títulos comuns são pulados. Na dúvida retorna null e a saudação sai neutra.
const PUSHNAME_TITLES = new Set([
  'prof', 'profa', 'profe', 'professor', 'professora',
  'dr', 'dra', 'sr', 'sra', 'srta', 'tia', 'tio', 'pastor', 'pastora',
])
export function firstNameFromPushName(pushName?: string): string | null {
  if (!pushName) return null
  for (const raw of pushName.split(/\s+/)) {
    // remove emoji/pontuação/dígito preservando acentos; ª/º contam como letra no Unicode ("Profª")
    const token = raw.replace(/[^\p{L}]/gu, '').replace(/[ªº]/g, '')
    if (token.length < 2 || token.length > 20) continue
    if (PUSHNAME_TITLES.has(token.toLowerCase())) continue
    return token[0].toUpperCase() + token.slice(1).toLowerCase()
  }
  return null
}

export class FlowExecutionService {
  constructor(
    private flowRepo: FlowRepository,
    private convRepo: ConversationRepository,
    private leadRepo: LeadRepository,
    private messaging: MessagingPort,
    private aiService: AIGenerationService,
    private eventRepo?: ConversationEventRepository,
    private paymentOrchestrator?: PaymentOrchestrator,
    private paymentIntentRepo?: PaymentIntentRepository,
    private catalogSearchService?: CatalogSearchService,
    private productRepo?: ProductRepository,
    private orderRepo?: OrderRepository,
    private deliveryService?: DeliveryService,
    private packageOfferRepo?: PackageOfferRepository,
    private handoffRepo?: HandoffRepository,
    private contextualAIRouter?: ContextualAIRouter,
    private paymentPhaseRouter?: PaymentPhaseRouter,
    private capabilityRouter?: CapabilityRouter,
    private observationRepo?: AIObservationRepository,
    private visionTitleExtractor?: VisionTitleExtractor,
    private conversationOutcomeRepo?: ConversationOutcomeRepository,
  ) {}

  // F0 (gerador evolutivo) — materializa o desfecho da conversa. Fire-and-forget + idempotente:
  // NUNCA bloqueia nem quebra o fluxo de venda. Ver Brain/spec_gerador_evolutivo.md.
  private recordOutcome(conversation: Conversation, outcome: ConversationOutcomeType, gmvCentavos?: number): void {
    this.conversationOutcomeRepo?.record({
      conversationId: conversation.id,
      botId: conversation.botId,
      flowId: conversation.flowId ?? null,
      lastPhase: conversation.phase ?? null,
      outcome,
      gmvCentavos: gmvCentavos ?? null,
    }).catch(e => console.error('[FES] outcome record failed:', e?.message))
  }

  /**
   * True when an incoming image must be treated as a payment receipt (do NOT run series-title vision).
   * Gates Feature A so we never hijack the PIX receipt flow.
   */
  private isReceiptImageContext(conversation: Conversation, flow: Flow): boolean {
    if (conversation.phase === 'awaiting_payment') return true
    if (conversation.status === 'waiting') {
      const node = flow.getNodeById(conversation.currentNodeId)
      if (node?.type === 'ai_validate_receipt') return true
      if (node?.type === 'capture' && (node.data as CaptureNodeData).expectedInputType === 'image') return true
    }
    return false
  }

  private emit(botId: string, convId: string | null | undefined, phone: string, type: Parameters<ConversationEventRepository['emit']>[0]['eventType'], payload: Record<string, unknown> = {}): void {
    // convId null é válido (ex.: ack inline pós-compra, sem conversa) — descartar aqui
    // apagava a telemetria post_purchase_support_started (alarme quebrado da baseline).
    this.eventRepo?.emit({ botId, conversationId: convId ?? null, phoneNumber: phone, eventType: type, payload, occurredAt: new Date() }).catch(e => console.error('[FlowExecution] event emit failed:', e?.message))
  }

  // Scored recovery — returns 0..1, threshold = 0.6
  private recoveryScore(message: string, snapshot: ConversationSnapshot | null, hasImage: boolean): number {
    if (hasImage) {
      const isMediaContext = snapshot?.recoveryHints?.some(h => ['comprovante', 'pix', 'foto', 'imagem', 'image', 'foto'].includes(h.toLowerCase()))
        || snapshot?.suspendedReason?.includes('pix')
        || snapshot?.suspendedReason?.includes('image')
        || snapshot?.pendingAction?.includes('pix')
      return isMediaContext ? 0.97 : 0.75
    }

    const hints = snapshot?.recoveryHints
    if (!hints || hints.length === 0) return 0.25 // no hints = ambiguous, don't blind-recover

    const lower = message.toLowerCase().trim()
    if (lower.length <= 2) return 0.05 // "ok", "kk" — not a recovery signal

    if (hints.some(h => lower === h.toLowerCase())) return 0.95

    const containsCount = hints.filter(h => lower.includes(h.toLowerCase())).length
    if (containsCount > 0) return Math.min(0.7 + containsCount * 0.08, 0.92)

    return 0.15
  }

  // Returns the ID of the capture node where the conversation should resume after edit_order.
  // Priority 1: capture → catalog_search (series browsing — correct for support flows)
  // Priority 2: capture → classify_intent / ai_router (main flow intent classifier)
  private findMainCaptureNodeId(flow: Flow): string | null {
    // P1: capture that feeds directly into catalog search
    for (const edge of flow.edges) {
      const target = flow.getNodeById(edge.target)
      if (target?.type !== 'catalog_search') continue
      const source = flow.getNodeById(edge.source)
      if (source?.type === 'capture') return source.id
    }
    // P2: capture that feeds into intent classifier
    const intentNodeTypes = new Set(['classify_intent', 'ai_router'])
    for (const edge of flow.edges) {
      const target = flow.getNodeById(edge.target)
      if (!target || !intentNodeTypes.has(target.type)) continue
      const source = flow.getNodeById(edge.source)
      if (source?.type === 'capture') return source.id
    }
    return null
  }

  // #5 — log every phase transition with from/to/reason
  private transitionPhase(conversation: Conversation, newPhase: ConversationPhase, reason: string): void {
    const from = conversation.phase ?? 'none'
    if (from !== newPhase) {
      flog('phase_transition', {
        layer: 'conversation_state',
        from,
        to: newPhase,
        reason,
        convId: conversation.id.slice(0, 8),
        phone: conversation.phoneNumber,
      })
    }
    conversation.setPhase(newPhase)
  }

  private isAcknowledgment(message: string): boolean {
    const acks = ['ok', 'okay', 'obrigado', 'obg', 'valeu', 'vlw', 'tks', 'thanks', 'ótimo', 'otimo', '👍', '🙏']
    const lower = message.toLowerCase().trim()
    return acks.some(a => lower === a || lower.startsWith(a + ' ') || lower.endsWith(' ' + a))
  }

  // ── Contextual yes/no helpers ────────────────────────────────────────────

  private detectBotQuestionType(lastBotMessage: string | null): 'want_more_items' | 'confirm_suggested_title' | 'confirm_checkout' | 'unknown' {
    if (!lastBotMessage) return 'unknown'
    const m = lastBotMessage.toLowerCase()
    if (/quer mais alguma|mais alguma|quer outra|tem mais alguma|adicionar outra/.test(m)) return 'want_more_items'
    if (/[eé] essa|[eé] esse|[eé] essa que você quer|encontrei.*cat[aá]logo|no nosso cat[aá]logo/.test(m)) return 'confirm_suggested_title'
    if (/gero o pix|pode cobrar|gerar o pix|fechar pedido|valor total|finalizar/.test(m)) return 'confirm_checkout'
    return 'unknown'
  }

  private isYesMessage(text: string): boolean {
    const t = text.toLowerCase().trim()
    // Only exact matches or very short phrases — conservative to avoid false positives
    const exactYes = new Set(['sim', 's', 'yeah', 'yes', 'claro', 'pode', 'bora', 'isso', 'exato', 'correto'])
    if (exactYes.has(t)) return true
    return /^(sim|s|claro|pode|bora|isso|exato|correto)[.!,]?\s*$/.test(t) ||
           /^(é isso|é essa|é esse|quero|tá bom|pode ser|aham)[.!,]?\s*$/.test(t)
  }

  private isNoMessage(text: string): boolean {
    const t = text.toLowerCase().trim()
    const exactNo = new Set(['não', 'nao', 'n', 'nope', 'negativo'])
    if (exactNo.has(t)) return true
    return /^(n[aã]o|n|nope|negativo)[.!,]?\s*$/.test(t) ||
           /^(n[aã]o quero|n[aã]o obrigado|n[aã]o preciso)[.!,]?\s*$/.test(t)
  }

  private canRecover(conversation: Conversation, message: string, hasImage: boolean): boolean {
    if (conversation.status !== 'suspended') return false
    const daysSince = (Date.now() - conversation.updatedAt.getTime()) / 86_400_000
    if (daysSince > 7) return false // beyond Redis TTL
    const score = this.recoveryScore(message, conversation.snapshot, hasImage)
    return score >= RECOVERY_THRESHOLD
  }

  async handleIncomingMessage(
    bot: Bot,
    phoneNumber: string,
    message: string,
    imageBase64?: string,
    inbound?: { msgId?: string; hasImage?: boolean; hasAudio?: boolean; pushName?: string },
  ): Promise<void> {
    // Sem flow ativo ainda pode haver funil por keyword (bot runtime='agent') —
    // o guard de flow inexistente acontece adiante, quando o flowId é resolvido.
    if (!bot.isActive) return

    const msgId = inbound?.msgId
    const hasImage = inbound?.hasImage ?? !!imageBase64

    let conversation = await this.convRepo.findActiveByPhone(bot.id, phoneNumber)
    let lead = await this.leadRepo.findByPhone(bot.id, phoneNumber)

    flog('incoming', {
      phone: phoneNumber,
      msgId: msgId ?? null,
      hasImage,
      msg: message.slice(0, 80),
      convStatus: conversation?.status ?? 'none',
      convNode: conversation?.currentNodeId ?? null,
      convPhase: conversation?.phase ?? null,
      leadTags: lead?.tags ?? [],
    })

    // Guard: conversation in human handoff — log but do not process through flow
    if (conversation?.status === 'handoff') {
      console.log(`[FlowExecution] message_during_handoff for ${phoneNumber}: "${message.slice(0, 60)}"`)
      return
    }

    // Guard: awaiting_payment phase — route through dedicated PaymentPhaseRouter (images bypass, go to receipt node)
    if (conversation && !hasImage && conversation.phase === 'awaiting_payment' && this.paymentPhaseRouter) {
      const cart = Cart.fromVariables(conversation.variables)
      const history = conversation.history.slice(-6)
      const lastBotMessage = [...history].reverse().find(m => m.role === 'assistant')?.content ?? null
      const paymentIntentId =
        conversation.variables['__rt_checkout_payment_id'] ??
        conversation.variables['paymentIntentId'] ??
        null
      const minutesSincePixGenerated = Math.floor((Date.now() - conversation.updatedAt.getTime()) / 60_000)

      const decision = await this.paymentPhaseRouter.route({
        userMessage: message,
        lastBotMessage,
        cartItems: cart.items,
        cartTotalBrl: cart.totalInBRL,
        paymentIntentId,
        minutesSincePixGenerated,
        hasImage: false,
        persona: buildBotPersona(bot.globalConfig, bot.id),
        botId: bot.id,
        conversationId: conversation.id,
        phoneNumber,
      })

      const instance = bot.evolutionConfig.instanceName
      const instanceId = bot.evolutionConfig.instanceId ?? ''

      switch (decision.intent) {
        case 'receipt_sent': {
          const reply = 'Perfeito 😊 Agora me envie o print/comprovante do Pix por aqui para eu confirmar.'
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: reply })
          conversation.addAssistantMessage(reply)
          await this.convRepo.save(conversation)
          return
        }
        case 'resend_pix': {
          const pixKey = conversation.variables['__rt_checkout_pix_key']
            ?? conversation.variables['paymentPixKey']
            ?? bot.globalConfig?.defaultPixKey
            ?? ''
          const pixAmount = conversation.variables['__rt_checkout_final_total_brl']
            ?? conversation.variables['__rt_cart_total_brl']
            ?? ''
          const pixName = bot.globalConfig?.defaultReceiverName ?? ''
          const intro = `Claro 😊 Segue a chave pix${pixAmount ? ` — valor: *${pixAmount}*` : ''}:`
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: intro })
          if (pixKey) {
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: pixKey })
          } else {
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: 'Me chama que te passo a chave 😊' })
          }
          conversation.addAssistantMessage(intro)
          await this.convRepo.save(conversation)
          return
        }
        case 'payment_help': {
          const reply = decision.reply || 'Pode me descrever melhor o que está acontecendo? Vou te ajudar 😊'
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: reply })
          conversation.addAssistantMessage(reply)
          await this.convRepo.save(conversation)
          return
        }
        case 'edit_order': {
          // Cancel the active PaymentIntent in the DB so the old Pix is invalid
          let hadActiveIntent = false
          if (this.paymentIntentRepo) {
            const activeIntent = await this.paymentIntentRepo.findPendingByConversation(conversation.id)
            if (activeIntent) {
              hadActiveIntent = true
              activeIntent.cancel()
              await this.paymentIntentRepo.save(activeIntent)
              console.log(`[PaymentPhaseRouter] cancelled payment_intent=${activeIntent.id} for conv=${conversation.id}`)
            }
          }

          // Clear payment vars (keep cart — user can add more or swap below)
          // #fix phantom-pix: só dizemos "Cancelei o Pix" se realmente havia um (intent pendente OU var de pagamento setada).
          const pixCancelled = hadActiveIntent || !!conversation.variables['__rt_checkout_payment_id']
          conversation.setVariable('__rt_checkout_payment_id', '')
          conversation.setVariable('paymentIntentId', '')
          this.transitionPhase(conversation, 'browsing_catalog', 'edit_order_intent')

          // #2 PaymentPhaseRouter action log
          flog('payment_router:action', {
            layer: 'payment_router',
            intent: 'edit_order',
            paymentIntentId,
            pixCancelled,
            cartPreserved: true,
            cartCount: cart.items.length,
            cartTotal: cart.totalInBRL,
          })

          // Move conversation back to the main capture node so the next message flows normally.
          // Use the conversation's own flowId so support flows (buyer tag) land correctly.
          const editFlowId = conversation.flowId ?? bot.activeFlowId!
          const editFlow = await this.flowRepo.findById(editFlowId)
          if (editFlow) {
            const mainCaptureId = this.findMainCaptureNodeId(editFlow)
            if (mainCaptureId) {
              conversation.moveToNode(mainCaptureId)
            }
          }

          // Build current cart context so the user knows what's still in the bag
          const currentCart = Cart.fromVariables(conversation.variables)
          let cartInfo = ''
          if (!currentCart.isEmpty) {
            const items = currentCart.items.map(i => `• ${i.name}`).join('\n')
            cartInfo = `\n\nSeu carrinho atual:\n${items}\n\nMe diz o que quer mudar — pode adicionar, trocar ou tirar séries 😊`
          }

          const cancelLine = pixCancelled ? ' Cancelei o Pix gerado.' : ''
          const reply = `Sem problema 😊${cancelLine}${cartInfo || '\n\nMe fala quais séries você quer deixar!'}`
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: reply })
          conversation.addAssistantMessage(reply)
          await this.convRepo.save(conversation)
          return
        }
        case 'cancel_order': {
          // Cancel the active PaymentIntent in the DB
          if (this.paymentIntentRepo) {
            const activeIntent = await this.paymentIntentRepo.findPendingByConversation(conversation.id)
            if (activeIntent) {
              activeIntent.cancel()
              await this.paymentIntentRepo.save(activeIntent)
              console.log(`[PaymentPhaseRouter] cancelled payment_intent=${activeIntent.id} for conv=${conversation.id}`)
            }
          }

          // Clear payment vars + cart
          const cancelPixCancelled = !!conversation.variables['__rt_checkout_payment_id']
          conversation.setVariable('__rt_checkout_payment_id', '')
          conversation.setVariable('paymentIntentId', '')
          for (const key of Cart.clearKeys()) {
            conversation.setVariable(key, '')
          }

          // #2 + #10 cancel_order log
          flog('payment_router:action', {
            layer: 'payment_router',
            intent: 'cancel_order',
            paymentIntentId,
            pixCancelled: cancelPixCancelled,
            cartPreserved: false,
            cartCleared: true,
          })
          flog('analytics:abandonment', {
            layer: 'business_analytics',
            event: 'order_cancelled',
            abandonmentPhase: 'awaiting_payment',
            phone: phoneNumber,
            cartCount: cart.items.length,
            cartTotal: cart.totalInBRL,
          })

          const reply = 'Tudo bem, sem pressão! 😊 Qualquer hora que quiser voltar é só chamar. Até mais!'
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: reply })
          conversation.addAssistantMessage(reply)
          conversation.end()
          this.recordOutcome(conversation, 'abandoned', cart.totalCentavos || undefined)
          await this.convRepo.save(conversation)
          return
        }
        case 'internal_takeover': {
          const reply = 'Claro 😊 Vou verificar isso com mais cuidado pra te ajudar certinho.'
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: reply })
          conversation.addAssistantMessage(reply)
          await this.createHandoff({ bot, conversation, lead, reason: 'pix_failed', lastMessage: message })
          conversation.handoff()
          await this.convRepo.save(conversation)
          return
        }
        case 'noise':
        default: {
          const reply = decision.reply || 'Perfeito 😊 Qualquer hora me envie o comprovante do Pix!'
          if (reply) {
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: reply })
            conversation.addAssistantMessage(reply)
          }
          await this.convRepo.save(conversation)
          return
        }
      }
    }

    // Recovery: suspended conversation takes priority over starting a new flow
    if (conversation && this.canRecover(conversation, message, hasImage)) {
      const score = this.recoveryScore(message, conversation.snapshot, hasImage)
      console.log(`[FlowExecution] recovery_triggered for ${phoneNumber} at node ${conversation.currentNodeId} (score=${score.toFixed(2)}, reason=${conversation.snapshot?.suspendedReason ?? 'none'})`)
      this.emit(bot.id, conversation.id, phoneNumber, 'recovery_triggered', {
        nodeId: conversation.currentNodeId,
        suspendedReason: conversation.snapshot?.suspendedReason,
        score,
      })
      conversation.resume()
    }

    const isNewConversation = !conversation || conversation.status === 'ended'

    // Buyer guard: recent buyer sending an ack should NOT restart the sale flow
    if (isNewConversation && lead?.isRecentBuyer()) {
      const resolvedFlowId = bot.resolveFlowId(lead.tags) ?? bot.activeFlowId
      const hasDedicatedSupportFlow = resolvedFlowId !== bot.activeFlowId

      if (!hasDedicatedSupportFlow && this.isAcknowledgment(message)) {
        console.log(`[FlowExecution] start_flow_blocked_buyer_recent_payment for ${phoneNumber} — ack "${message}"`)
        this.emit(bot.id, conversation?.id, phoneNumber, 'post_purchase_support_started', {
          trigger: message,
          inline: true,
          lastPaymentConfirmedAt: lead.lastPaymentConfirmedAt?.toISOString(),
        })
        await this.messaging.sendMessage({
          instanceName: bot.evolutionConfig.instanceName,
          instanceId: bot.evolutionConfig.instanceId,
          phoneNumber,
          message: 'Às ordens! 😊 Qualquer dúvida é só chamar.',
        })
        return
      }

      if (hasDedicatedSupportFlow) {
        console.log(`[FlowExecution] post_purchase_support_started for ${phoneNumber} → flow ${resolvedFlowId}`)
        this.emit(bot.id, conversation?.id, phoneNumber, 'post_purchase_support_started', {
          trigger: message,
          supportFlowId: resolvedFlowId,
          lastPaymentConfirmedAt: lead.lastPaymentConfirmedAt?.toISOString(),
        })
      }
    }

    // Roteamento determinístico por keyword (funis paralelos no MESMO número):
    // em conversa NOVA, um flow não-default cujo trigger é 'keyword' e casa com a mensagem
    // vence a regra de tag e o CapabilityRouter. O flow default (any_message) segue intacto
    // para todo o resto do tráfego. Entrada típica: anúncio com texto pré-preenchido.
    let keywordFlow: Flow | undefined
    if (isNewConversation) {
      const botFlows = await this.flowRepo.findByBotId(bot.id)
      keywordFlow = botFlows.find(f => {
        if (f.id === bot.activeFlowId) return false
        const trig = f.nodes.find(n => n.type === 'trigger')
        const d = trig?.data as TriggerNodeData | undefined
        return d?.triggerType === 'keyword' && !!d?.keywords?.length && this.matchesTrigger(f, message)
      })
      if (keywordFlow) {
        console.log(`[FES:keyword_flow] phone="${phoneNumber}" flow="${keywordFlow.name}" id=${keywordFlow.id} matched keyword trigger`)
      }
    }

    // CapabilityRouter: on new conversations (or ended), let AI pick the right flow.
    // LEGADO em aposentadoria (Brain/spec_aposentadoria_roteadores.md) — gate per-bot, default mantém.
    if (isNewConversation && !keywordFlow && this.capabilityRouter && bot.globalConfig?.capabilityRouterEnabled !== false) {
      const cart = conversation ? Cart.fromVariables(conversation.variables) : Cart.empty()
      const capDecision = await this.capabilityRouter.route({
        botId: bot.id,
        conversationId: conversation?.id ?? '',
        phoneNumber,
        message,
        phase: conversation?.phase ?? 'initial',
        leadTags: lead?.tags ?? [],
        cartCount: cart.items.length,
        hasPendingPayment: conversation?.phase === 'awaiting_payment',
        history: conversation?.history ?? [],
        hasImage,
      })

      console.log(`[CapabilityRouter] method=${capDecision.method} capability=${capDecision.capability?.name ?? 'none'} confidence=${capDecision.confidence.toFixed(2)}`)

      if (capDecision.capability?.flowId) {
        const capFlow = await this.flowRepo.findById(capDecision.capability.flowId)
        // #sec defesa-em-profundidade: a capability NÃO pode rotear pra um flow de OUTRO bot
        // (flowId malicioso sequestraria a conversa). Só aceita flow do próprio bot.
        if (capFlow && capFlow.botId === bot.id) {
          if (!this.matchesTrigger(capFlow, message)) return
          conversation = Conversation.create({
            botId: bot.id,
            flowId: capFlow.id,
            phoneNumber,
            triggerNodeId: capFlow.getTriggerNode().id,
          })
          if (!lead) lead = Lead.create({ botId: bot.id, phoneNumber })
          else lead.recordSession()
          lead.touch()
          this.applyLeadName(conversation, lead, inbound?.pushName)
          conversation.setVariable('__lead_tags', lead.tags.join(','))
          conversation.setVariable('__lead_temperature', lead.leadTemperature)
          conversation.setVariable('__lead_sessions', String(lead.totalSessions))
          conversation.setVariable('__lead_is_returning', lead.totalSessions > 1 ? 'true' : 'false')
          conversation.setVariable('__lead_purchased_count', String(lead.purchasedTitles.length))
          conversation.addUserMessage(message)
          await this.leadRepo.save(lead)
          await this.executeFlow(bot, capFlow, conversation, lead)
          return
        }
      }
    }

    let flowId: string | null | undefined
    let flowReason: string
    if (isNewConversation) {
      if (keywordFlow) {
        flowId = keywordFlow.id
        flowReason = 'trigger_keyword'
      } else {
        const routed = bot.resolveFlowId(lead?.tags ?? [])
        flowId = routed ?? bot.activeFlowId
        flowReason = (routed && routed !== bot.activeFlowId) ? 'regra_de_tag' : 'flow_ativo_padrao'
      }
    } else {
      flowId = conversation!.flowId
      flowReason = 'conversa_em_andamento'
    }

    if (!flowId) return
    const flow = await this.flowRepo.findById(flowId)
    if (!flow) return
    // Observabilidade: QUAL fluxo está sendo chamado AGORA e POR QUÊ (regra de tag vs default vs em andamento).
    console.log(`[FES:flow_resolved] phone="${phoneNumber}" flow="${flow.name}" id=${flow.id} reason=${flowReason} isNew=${isNewConversation} tags=[${(lead?.tags ?? []).join(',')}]`)

    if (!conversation || conversation.status === 'ended') {
      if (!this.matchesTrigger(flow, message)) return
      conversation = Conversation.create({
        botId: bot.id,
        flowId: flow.id,
        phoneNumber,
        triggerNodeId: flow.getTriggerNode().id,
      })
    }

    if (!lead) {
      lead = Lead.create({ botId: bot.id, phoneNumber })
    } else if (isNewConversation) {
      lead.recordSession()
    } else {
      lead.touch()
    }

    // Reconcile temperature: buyer tag → at least 'warm'; confirmed payment → at least 'hot'
    if (lead.tags.includes('buyer') && lead.leadTemperature === 'cold') {
      lead.setTemperature(lead.lastPaymentConfirmedAt ? 'hot' : 'warm')
    }

    // Nome do cliente (pushName → 1º nome) — saudação pronta pros templates do funil
    this.applyLeadName(conversation, lead, inbound?.pushName)

    // inject lead context into conversation variables (P2 — memory layer)
    conversation.setVariable('__lead_tags', lead.tags.join(','))
    conversation.setVariable('__lead_temperature', lead.leadTemperature)
    conversation.setVariable('__lead_sessions', String(lead.totalSessions))
    conversation.setVariable('__lead_is_returning', lead.totalSessions > 1 ? 'true' : 'false')
    conversation.setVariable('__lead_purchased_count', String(lead.purchasedTitles.length))
    if (lead.name) conversation.setVariable('__lead_name', lead.name)
    if (lead.contextSummary) conversation.setVariable('__lead_context', lead.contextSummary)

    // Feature A: stray image (not a payment receipt) — read the visible series title(s) and feed
    // them into the normal flow (classify_intent → catalog_search). Gated so the PIX receipt flow is untouched.
    if (hasImage && imageBase64 && this.visionTitleExtractor && !this.isReceiptImageContext(conversation, flow)) {
      const titles = await this.visionTitleExtractor.extract(imageBase64)
      if (titles.length) {
        flog('vision_title_extract', { phone: phoneNumber, titles })
        message = titles.join(', ')
      }
    }

    conversation.addUserMessage(message, {
      msgId, sender: phoneNumber,
      // marca a mídia recebida (comprovante/print aparece como 📷 no painel)
      ...(hasImage ? { media: { type: 'image' as const } } : inbound?.hasAudio ? { media: { type: 'audio' as const } } : {}),
    })
    if (imageBase64) conversation.setVariable('__imageBase64', imageBase64)

    // Webapp selection arriving during a waiting capture — bypass the capture and re-route through classify_intent
    // Without this, the selection text is captured as the answer to the pending question, leading to duplicate cart adds
    if (conversation.status === 'waiting' && !hasImage && this.isWebappSelection(message)) {
      const classifyNode = flow.nodes.find(n => n.type === 'classify_intent')
      if (classifyNode) {
        console.log(`[FlowExecution] webapp_selection_during_wait — bypassing capture at ${conversation.currentNodeId}, rerouting to ${classifyNode.id}`)
        conversation.resume()
        conversation.moveToNode(classifyNode.id)
        await this.executeFlow(bot, flow, conversation, lead)
        lead.mergeVariables(conversation.variables)
        await this.leadRepo.save(lead)
        await this.convRepo.save(conversation)
        return
      }
    }

    if (conversation.status === 'waiting') {
      const currentNode = flow.getNodeById(conversation.currentNodeId)
      if (currentNode?.type === 'capture') {
        const data = currentNode.data as CaptureNodeData
        const instance = bot.evolutionConfig.instanceName
        const instanceId = bot.evolutionConfig.instanceId

        // ── expectedInputType enforcement ──────────────────────────────────
        // Before rejecting, check if the interceptor can handle this message
        if (data.expectedInputType === 'image' && !hasImage) {
          if (data.interceptor?.enabled) {
            const ic = await this.runCaptureInterceptor(data.interceptor, message, conversation, lead, bot)

            if (ic.action === 'answer' && ic.message) {
              console.log(`[capture_interceptor] inline answer node=${currentNode.id} msg="${message.slice(0, 60)}"`)
              await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber, message: ic.message })
              conversation.addAssistantMessage(ic.message)  // #fix history-drift: a resposta do interceptor precisa entrar no histórico
              await this.convRepo.save(conversation)
              return // stay in waiting — still expects the image
            }

            // #fix interceptor-handoff: reclamação pós-venda ("não abre", reembolso, irritado) entrava como
            // "answer" e nunca era contada como rejeição → o auto-handoff (capture rejeitado N×) NUNCA disparava.
            // Aqui o interceptor escala direto: createHandoff + avisa o dono + suspende (bot pausa).
            if (ic.action === 'handoff') {
              console.warn(`[capture_interceptor] handoff node=${currentNode.id} phone=${phoneNumber} msg="${message.slice(0, 80)}"`)
              // Persiste o handoff PRIMEIRO e SEM engolir o erro: se o save falhar, a exceção propaga,
              // a fila re-tenta a mensagem (idempotente — createHandoff dedup handoff aberto) e NÃO marcamos
              // handoff() sem registro (evita órfão: status pausado sem ninguém saber).
              await this.createHandoff({ bot, conversation, lead, reason: 'user_request', lastMessage: message })
              const ownerPhone = bot.globalConfig?.ownerPhone
              if (ownerPhone) {
                await this.messaging.sendMessage({
                  instanceName: instance, instanceId, phoneNumber: ownerPhone,
                  message: `🆘 *Suporte pós-venda* — ${phoneNumber} relatou um problema durante a espera de comprovante: "${message.slice(0, 120)}". Conversa pausada e escalada — assuma.`,
                }).catch(() => {})  // notificação ao dono é best-effort; o registro no DB é a fonte de verdade
              }
              conversation.handoff()
              await this.convRepo.save(conversation)
              return
            }

            if (ic.action === 'redirect' && ic.handle) {
              const target = flow.getNextNodes(currentNode.id, ic.handle)[0]
              if (target) {
                console.log(`[capture_interceptor] redirect node=${currentNode.id} handle=${ic.handle} target=${target.id}`)
                conversation.resume()
                conversation.moveToNode(target.id)
                // fall through to executeFlow below
                await this.executeFlow(bot, flow, conversation, lead)
                lead.mergeVariables(conversation.variables)
                await this.leadRepo.save(lead)
                return
              }
            }
            // action === 'ignore' — fall through to normal rejection
          }

          // Escape hatch: cliente mandou texto onde esperávamos imagem (ex: dúvida no meio).
          // GUARDA: nunca no caminho do dinheiro (awaiting_payment fica com o PaymentPhaseRouter). Só sem interceptor.
          if (!data.interceptor?.enabled && conversation.phase !== 'awaiting_payment') {
            const esc = await this.runEscapeHatch(flow, conversation, lead, bot, message, [])
            if (esc.outcome === 'answered' || esc.outcome === 'handoff') {
              await this.convRepo.save(conversation)
              return // respondeu/escalou e continua aguardando a imagem
            }
          }

          console.warn(
            `[FlowExecution] capture_rejected: node=${currentNode.id} conv=${conversation.id} ` +
            `phone=${phoneNumber} msgId=${msgId ?? 'n/a'} reason=expected_image_got_text ` +
            `msg="${message.slice(0, 80)}"`
          )
          // Rede de segurança: se o cliente travar aqui N vezes, escala pro humano (não fica em loop).
          if (await this.maybeAutoHandoffOnCaptureReject({ bot, conversation, lead, reason: 'expected_image_got_text', lastMessage: message })) {
            await this.convRepo.save(conversation)
            return
          }
          await this.messaging.sendMessage({
            instanceName: instance,
            instanceId,
            phoneNumber,
            message: data.errorMessage ?? '📎 Por favor, envie a *imagem do comprovante* (não texto).',
          })
          await this.convRepo.save(conversation)
          return
        }

        // ── validationRegex check ──────────────────────────────────────────
        if (data.validationRegex && !this.safeRegexTest(data.validationRegex, message)) {
          // Escape hatch: entrada não bate o formato esperado (ex: pergunta no lugar do dado). Gated, per-part.
          if (conversation.phase !== 'awaiting_payment') {
            const esc = await this.runEscapeHatch(flow, conversation, lead, bot, message, [])
            if (esc.outcome === 'answered' || esc.outcome === 'handoff') {
              await this.convRepo.save(conversation)
              return // respondeu/escalou e continua aguardando a entrada válida
            }
          }

          console.warn(
            `[FlowExecution] capture_rejected: node=${currentNode.id} conv=${conversation.id} ` +
            `phone=${phoneNumber} msgId=${msgId ?? 'n/a'} reason=regex_mismatch`
          )
          // Rede de segurança: se o cliente travar aqui N vezes, escala pro humano (não fica em loop).
          if (await this.maybeAutoHandoffOnCaptureReject({ bot, conversation, lead, reason: 'regex_mismatch', lastMessage: message })) {
            await this.convRepo.save(conversation)
            return
          }
          // Re-âncora NÃO repete em rajada: se já mandamos o aparte há <60s, fica em
          // silêncio aguardando (evita "papagaio" quando a pessoa manda 2-3 msgs seguidas).
          const lastErrAt = Number(conversation.variables['__capture_errmsg_at'] ?? 0)
          if (!lastErrAt || Date.now() - lastErrAt >= 60_000) {
            conversation.setVariable('__capture_errmsg_at', String(Date.now()))
            await this.messaging.sendMessage({
              instanceName: instance,
              instanceId,
              phoneNumber,
              message: data.errorMessage ?? 'Entrada inválida. Tente novamente.',
            })
          }
          await this.convRepo.save(conversation)
          return
        }

        // ── accept: store value + audit metadata ───────────────────────────
        let capturedValue = hasImage ? (imageBase64 ? '[image]' : message) : message
        // Menu-style: valueMap traduz a resposta crua pro rótulo ("1" → "2 a 3 anos").
        // O atalho do dígito só vale quando a resposta é ESSENCIALMENTE um dígito
        // ("1", "1️⃣", "opção 2") — resposta por extenso ("3 a 4 anos" tem 2 dígitos)
        // fica como digitada, senão mapearia pro item errado do menu.
        if (data.valueMap && !hasImage) {
          const raw = capturedValue.trim().toLowerCase()
          const digits = raw.match(/\d/g) ?? []
          const digitKey = digits.length === 1 && raw.length <= 10 ? digits[0] : undefined
          const mapped = data.valueMap[raw] ?? (digitKey ? data.valueMap[digitKey] : undefined)
          if (mapped) capturedValue = mapped
        }
        conversation.setVariable(data.variableName, capturedValue)
        conversation.setVariable('__capture_reject_count', '0')  // aceitou → zera a rede de segurança (auto-handoff)
        conversation.setVariable('__capture_errmsg_at', '')       // próximo capture ganha aparte novo
        conversation.setVariable('__capture_reject_at', '')
        conversation.setVariable(`__capture_meta_${data.variableName}`, JSON.stringify({
          msgId: msgId ?? null,
          direction: 'inbound',
          sender: phoneNumber,
          nodeId: currentNode.id,
          conversationId: conversation.id,
          hasImage,
          timestamp: new Date().toISOString(),
        }))

        console.log(
          `[FlowExecution] capture_accepted: node=${currentNode.id} conv=${conversation.id} ` +
          `phone=${phoneNumber} msgId=${msgId ?? 'n/a'} direction=inbound sender=${phoneNumber} ` +
          `var=${data.variableName} hasImage=${hasImage} value="${capturedValue.slice(0, 60)}"`
        )

        // advance to responded handle; fall back to any outgoing edge
        const next = flow.getNextNodes(currentNode.id, 'responded')[0]
          ?? flow.getNextNodes(currentNode.id)[0]
        if (next) conversation.moveToNode(next.id)
        else { conversation.end(); await this.convRepo.save(conversation); return }
      }
    }

    await this.executeFlow(bot, flow, conversation, lead)
    lead.mergeVariables(conversation.variables)
    await this.leadRepo.save(lead)
  }

  // Fixa o 1º nome do lead (pushName do WhatsApp, sanitizado) e expõe as variáveis de
  // saudação pros templates: {{nome}} = "Maria" | "" e {{saudacao_nome}} = ", Maria" | ""
  // (uso: "Oi{{saudacao_nome}}!" → "Oi, Maria!" ou "Oi!" sem nome — nunca vírgula órfã).
  private applyLeadName(conversation: Conversation, lead: Lead, pushName?: string): void {
    if (!lead.name) {
      const first = firstNameFromPushName(pushName)
      if (first) lead.setName(first)
    }
    // Não sobrescreve valor não-vazio: um capture do flow pode ter perguntado o nome
    // (variável 'nome' é do operador) — o pushName só preenche o que está vazio.
    const vars = conversation.variables
    if (!vars['nome']) conversation.setVariable('nome', lead.name ?? '')
    if (!vars['saudacao_nome']) conversation.setVariable('saudacao_nome', lead.name ? `, ${lead.name}` : '')
  }

  async resumeFromNode(bot: Bot, flow: Flow, conversation: Conversation): Promise<void> {
    const lead = await this.leadRepo.findByPhone(bot.id, conversation.phoneNumber)
    await this.executeFlow(bot, flow, conversation, lead ?? undefined)
    if (lead) {
      lead.mergeVariables(conversation.variables)
      await this.leadRepo.save(lead)
    }
  }

  private async executeFlow(bot: Bot, flow: Flow, conversation: Conversation, lead?: Lead): Promise<void> {
    // Anti-loop com folga pra cadeias longas legítimas: a entrega do kit é
    // capture→validate→confirmed→label→16 docs→final→end = 23 passos; com o teto
    // antigo (20) o doc16 era o último passo e a mensagem final NUNCA saía.
    const maxSteps = 48
    let steps = 0
    const isStart = conversation.currentNodeId === flow.getTriggerNode().id

    flog('executeFlow', {
      flowId: flow.id,
      startNode: conversation.currentNodeId,
      isStart,
      convStatus: conversation.status,
      convPhase: conversation.phase ?? null,
    })

    if (isStart) {
      this.emit(bot.id, conversation.id, conversation.phoneNumber, 'flow_started', { flowId: flow.id, flowName: flow.name })
    }

    try {
      while (steps++ < maxSteps) {
        const node = flow.getNodeById(conversation.currentNodeId)
        if (!node || node.type === 'end') {
          conversation.end()
          flog('executeFlow:end', { steps, nodeId: conversation.currentNodeId, reason: !node ? 'node_not_found' : 'end_node' })
          this.emit(bot.id, conversation.id, conversation.phoneNumber, 'flow_completed', { flowId: flow.id, steps })
          this.recordOutcome(conversation, deriveTerminalOutcome(conversation.phase), Cart.fromVariables(conversation.variables).totalCentavos || undefined)
          // P2 — persist last state + generate context summary
          if (lead) {
            lead.setLastState(conversation.currentNodeId)
            lead.setContextSummary(this.buildContextSummary(lead, conversation))
          }
          break
        }

        flog('executeNode:enter', { step: steps, nodeId: node.id, nodeType: node.type })
        const nextNodeId = await this.executeNode(bot, flow, conversation, node, lead)
        flog('executeNode:exit', { nodeId: node.id, nodeType: node.type, nextNodeId: nextNodeId ?? null })

        if (nextNodeId === null) break // waiting for user input
        if (!nextNodeId) {
          // Terminal SEM próximo nó: se o nó colocou a conversa em handoff, o status é
          // sagrado — encerrar aqui sobrescrevia o handoff e a próxima mensagem do
          // cliente reiniciava o funil por cima do humano (bug de prod, 2x).
          if (conversation.status === 'handoff') break
          conversation.end()
          this.recordOutcome(conversation, deriveTerminalOutcome(conversation.phase), Cart.fromVariables(conversation.variables).totalCentavos || undefined)
          break
        }

        conversation.moveToNode(nextNodeId)
        // F0 — sinal de funil: cada nó que a conversa ALCANÇA (passo + tipo + fase). Único ponto central.
        const reached = flow.getNodeById(nextNodeId)
        if (reached) this.emit(bot.id, conversation.id, conversation.phoneNumber, 'node_reached', { nodeId: nextNodeId, nodeType: reached.type, phase: conversation.phase ?? null, step: steps })
      }
    } catch (err) {
      console.error('[executeFlow] unhandled node error at', conversation.currentNodeId, ':', err instanceof Error ? err.message : err)
    }

    await this.convRepo.save(conversation)
  }

  private async executeNode(
    bot: Bot,
    flow: Flow,
    conversation: Conversation,
    node: FlowNode,
    lead?: Lead,
  ): Promise<string | null | undefined> {
    const phone = conversation.phoneNumber
    const instance = bot.evolutionConfig.instanceName
    const instanceId = bot.evolutionConfig.instanceId

    switch (node.type) {
      case 'trigger': {
        // Webapp selection bypasses ALL intros — go straight to classify_intent
        {
          const triggerMsg = conversation.getLastUserMessage() ?? ''
          if (triggerMsg && this.isWebappSelection(triggerMsg)) {
            const classifyNode = flow.nodes.find(n => n.type === 'classify_intent')
            if (classifyNode) {
              console.log(`[FlowExecution] webapp_selection at trigger — bypassing intro for ${conversation.phoneNumber}`)
              return classifyNode.id
            }
          }
        }

        // Returning user — skip intro entirely if flow has a returning_user edge
        const returningEdge = flow.getNextNodes(node.id, 'returning_user')[0]
        if (returningEdge && lead && lead.totalSessions > 1 && !lead.tags.includes('buyer')) {
          console.log(`[FlowExecution] returning_user for ${conversation.phoneNumber} (sessions=${lead.totalSessions} tags=${lead.tags.join(',')}) → skipping intro`)
          return returningEdge.id
        }

        // P3 — intent-first onboarding: if first message already has clear intent, skip intro
        const firstMsg = conversation.getLastUserMessage()
        if (firstMsg) {
          const classifyNode = flow.nodes.find(n => n.type === 'classify_intent')
          const configuredIntents = (classifyNode?.data as import('@whatsbot/core').ClassifyIntentNodeData | undefined)?.intents
          const preClass = this.quickClassify(firstMsg, configuredIntents)
          if (preClass.confidence >= 0.75) {
            const intentFirstNext = flow.getNextNodes(node.id, 'intent_detected')[0]
            if (intentFirstNext) {
              conversation.setVariable('__rt_pre_classified', 'true')
              conversation.setVariable('__rt_intent', preClass.intent)
              conversation.setVariable('__rt_confidence', String(preClass.confidence))
              if (preClass.quantityDetected !== null)
                conversation.setVariable('__rt_intent_qty', String(preClass.quantityDetected))
              if (preClass.titleDetected)
                conversation.setVariable('__rt_title_detected', preClass.titleDetected)
              console.log(`[FlowExecution] intent_first_onboarding for ${conversation.phoneNumber}: ${preClass.intent} (${preClass.confidence.toFixed(2)}) → skipping intro`)
              return intentFirstNext.id
            }
          }
        }
        return flow.getNextNodes(node.id, 'output')[0]?.id ?? flow.getNextNodes(node.id)[0]?.id
      }

      case 'text_message': {
        const data = node.data as TextNodeData
        const msg = this.interpolate(data.message, conversation.variables)
        flog('msg:send', { nodeId: node.id, nodeType: 'text_message', hash: msgHash(msg), len: msg.length })
        await this.simulateTyping(bot, instance, instanceId, phone, msg.length)
        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
        conversation.addAssistantMessage(msg)
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'image': {
        const data = node.data as ImageNodeData
        const caption = data.caption ? this.interpolate(data.caption, conversation.variables) : undefined
        // Envio de mídia NUNCA quebra o funil: sem sendMedia no port ou URL fora do ar → loga e segue.
        const mediaType = data.mediaType ?? 'image'
        try {
          // documentos em sequência (entrega de kit) não simulam digitação — evita estourar o lock
          if (mediaType === 'image') {
            await this.simulateTyping(bot, instance, instanceId, phone, (caption ?? '').length || 80)
          }
          if (data.mediaUrl && this.messaging.sendMedia) {
            flog('msg:send', { nodeId: node.id, nodeType: 'image', mediaType, url: data.mediaUrl })
            await this.messaging.sendMedia({
              instanceName: instance,
              instanceId,
              phoneNumber: phone,
              mediaUrl: data.mediaUrl,
              mediaType,
              caption,
              filename: data.filename,
            })
            // registra a MÍDIA no histórico (painel renderiza player/thumbnail) — antes
            // só a legenda entrava e voice note/imagem sem caption ficavam invisíveis
            conversation.addAssistantMessage(caption ?? '', { type: mediaType, url: data.mediaUrl, filename: data.filename })
          } else if (caption) {
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: caption })
            conversation.addAssistantMessage(caption)
          }
        } catch (err) {
          console.error(`[FlowExecution] image_send_failed node=${node.id} url=${data.mediaUrl}: ${(err as Error).message}`)
        }
        return flow.getNextNodes(node.id)[0]?.id
      }

      case 'ai_response': {
        const data = node.data as AIResponseNodeData
        // Prefer node-level systemPrompt over bot default (allows per-node AI personas)
        const systemPrompt = (data as Record<string, unknown>).systemPrompt as string | undefined
          ?? bot.buildSystemPrompt()
        const imageBase64 = conversation.variables['__imageBase64']
        if (imageBase64) conversation.setVariable('__imageBase64', '') // consume — não reutilizar
        const nodeProvider = (data as Record<string, unknown>).provider as string | undefined
        const provider = imageBase64 ? 'claude' : (nodeProvider ?? bot.aiConfig.provider)
        const nodeTemp = (data as Record<string, unknown>).temperature as number | undefined
        const nodeMaxTokens = (data as Record<string, unknown>).maxTokens as number | undefined
        try {
          const result = await this.aiService.generate(provider, {
            systemPrompt,
            promptTemplate: data.promptTemplate,
            history: data.useHistory ? conversation.history.slice(-10) : [],
            userMessage: conversation.getLastUserMessage() ?? '',
            variables: conversation.variables,
            temperature: nodeTemp ?? bot.aiConfig.temperature,
            maxTokens: nodeMaxTokens ?? bot.aiConfig.maxTokens,
            cacheSystemPrompt: true,
            imageBase64,
          })
          conversation.addAssistantMessage(result.content)
          if (data.saveResponseAs) {
            conversation.setVariable(data.saveResponseAs, result.content)
          } else {
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: result.content })
          }
          const nexts = flow.getNextNodes(node.id, 'success')
          const fallback = flow.getNextNodes(node.id)
          return (nexts[0] ?? fallback[0])?.id
        } catch (err) {
          const errNodes = flow.getNextNodes(node.id, 'error')
          if (errNodes[0]) return errNodes[0].id
          return undefined
        }
      }

      case 'distributor': {
        const data = node.data as DistributorNodeData
        const variations = data.variations?.filter(Boolean) ?? []
        if (variations.length > 0) {
          const msg = this.interpolate(variations[Math.floor(Math.random() * variations.length)], conversation.variables)
          await this.simulateTyping(bot, instance, instanceId, phone, msg.length)
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
          // sem isso a bolha não aparece no painel de Conversas nem no contexto da IA
          conversation.addAssistantMessage(msg)
        }
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'notification': {
        const data = node.data as NotificationNodeData
        const notifVars = {
          ...conversation.variables,
          phone: conversation.phoneNumber,
          message: conversation.getLastUserMessage() ?? '',
        }
        const msg = this.interpolate(data.message, notifVars)
        const target = this.interpolate(data.phoneNumber, notifVars) || bot.globalConfig?.ownerPhone
        if (target && msg) {
          try {
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: target, message: msg })
          } catch (err) {
            console.error('[notification] failed to send:', err instanceof Error ? err.message : err)
          }
        }
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'pixel': {
        const data = node.data as PixelNodeData
        if (data.pixelId && data.accessToken) {
          const rawValue = data.value ? this.interpolate(String(data.value), conversation.variables) : '0'
          const payload = {
            data: [{
              event_name: data.eventName ?? 'Purchase',
              event_time: Math.floor(Date.now() / 1000),
              action_source: 'website',
              user_data: { ph: [conversation.phoneNumber.replace(/\D/g, '')] },
              custom_data: {
                value: parseFloat(rawValue) || 0,
                currency: data.currency ?? 'BRL',
              },
            }],
            access_token: data.accessToken,
          }
          try {
            await fetch(`https://graph.facebook.com/v18.0/${data.pixelId}/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          } catch (err) {
            console.error('[pixel] Facebook CAPI error:', err)
          }
        }
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'pix': {
        const data = node.data as PixNodeData
        const rawAmount = data.amount ? this.interpolate(String(data.amount), conversation.variables) : ''
        const desc = data.description ? this.interpolate(data.description, conversation.variables) : ''
        const receiverKey = data.pixKey ?? ''
        const receiverName = data.recipientName ?? ''

        let displayAmount = rawAmount
        const centavos = this.parseAmountToCentavos(rawAmount)

        if (centavos && centavos > 0 && receiverKey && this.paymentIntentRepo) {
          try {
            const expiresAt = data.expiresInMinutes
              ? new Date(Date.now() + data.expiresInMinutes * 60 * 1000)
              : new Date(Date.now() + 60 * 60 * 1000) // default 60min
            const intent = PaymentIntent.create({
              botId: bot.id,
              leadId: lead?.id ?? conversation.phoneNumber,
              conversationId: conversation.id,
              amount: centavos,
              receiverKey,
              receiverName,
              expiresAt,
            })
            await this.paymentIntentRepo.save(intent)
            const outputVar = data.outputVariable ?? 'paymentIntentId'
            conversation.setVariable(outputVar, intent.id)
            this.emit(bot.id, conversation.id, conversation.phoneNumber, 'payment_requested', {
              paymentIntentId: intent.id, amount: centavos, receiverKey,
            })
            displayAmount = `${(centavos / 100).toFixed(2).replace('.', ',')}`
          } catch (err) {
            console.error('[pix] PaymentIntent creation failed:', err)
          }
        }

        // brCode: "copia e cola" com valor embutido — a professora cola e o banco já
        // abre com valor+recebedor preenchidos (mata a fricção de digitar). Gated por
        // nó (flag no data) pra não mudar bots que vendem com a chave crua.
        const extra = data as { brCode?: boolean; merchantCity?: string; trustLine?: string }
        const brCode = extra.brCode && receiverKey && centavos
          ? buildPixBrCode({
              key: receiverKey,
              merchantName: receiverName || 'Recebedor',
              merchantCity: extra.merchantCity,
              amountCentavos: centavos,
            })
          : null

        const lines = brCode
          ? [`💳 *Pix de R$ ${displayAmount}*`]
          : [`💳 *Chave Pix para pagamento*`]
        if (!brCode && displayAmount) lines.push(``, `Valor: *R$ ${displayAmount}*`)
        if (desc) lines.push(brCode ? desc : `Descrição: ${desc}`)
        if (!brCode && receiverName) lines.push(`Favorecido: ${receiverName}`)
        if (extra.trustLine) lines.push(``, extra.trustLine)
        lines.push(``, brCode
          ? `_Copia o código abaixo e cola no app do seu banco em *Pix → copia e cola* — o valor já vai preenchido._`
          : `_Copie a chave abaixo e pague pelo seu banco._`)
        const pixMsg = lines.join('\n')
        const copyable = brCode ?? receiverKey
        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: pixMsg })
        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: copyable })
        conversation.addAssistantMessage(pixMsg)  // #fix history-drift: a IA precisa saber que o PIX já foi enviado
        conversation.addAssistantMessage(copyable) // código/chave visível no painel também
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'label': {
        const data = node.data as LabelNodeData
        // evolution-go: POST /label/chat {jid, labelId}. IDs padrão do WhatsApp Business:
        // 1 Novo cliente · 2 Novo pedido · 3 Pagamento pendente · 4 Pago · 5 Pedido finalizado.
        const labelId = data.labelId ?? data.labelName
        if (labelId) {
          const evolutionUrl = process.env.EVOLUTION_URL ?? 'http://localhost:8082'
          try {
            const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
            const res = await fetch(`${evolutionUrl}/label/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: instance },
              body: JSON.stringify({ jid, labelId: String(labelId) }),
            })
            if (!res.ok) console.error(`[label] evolution-go ${res.status}: ${(await res.text()).slice(0, 120)}`)
          } catch (err) {
            console.error('[label] Evolution label error:', err)
          }
        }
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'capture': {
        const data = node.data as CaptureNodeData
        const timeoutAt = data.timeoutMinutes
          ? new Date(Date.now() + data.timeoutMinutes * 60 * 1000)
          : undefined
        conversation.waitForInput(node.id, timeoutAt)
        await this.convRepo.save(conversation)
        return null
      }

      case 'condition': {
        const data = node.data as ConditionNodeData
        const value = conversation.variables[data.variable] ?? ''
        const matched = this.evaluateCondition(value, data.operator, data.value)
        const nexts = flow.getNextNodes(node.id, matched ? 'true' : 'false')
        flog('condition', { nodeId: node.id, variable: data.variable, value: value.slice(0, 60), operator: data.operator, expected: data.value, matched, next: nexts[0]?.id ?? null })
        return nexts[0]?.id
      }

      case 'webhook': {
        const data = node.data as WebhookNodeData
        const url = this.interpolate(data.url, conversation.variables)
        const body = data.bodyTemplate
          ? this.interpolate(data.bodyTemplate, conversation.variables)
          : undefined

        const res = await fetch(url, {
          method: data.method,
          headers: { 'Content-Type': 'application/json', ...(data.headers ?? {}) },
          body: body ? JSON.stringify(JSON.parse(body)) : undefined,
        })

        if (data.saveResponseAs) {
          const text = await res.text()
          conversation.setVariable(data.saveResponseAs, text)
        }

        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'delay': {
        const d = node.data as DelayNodeData
        await new Promise(r => setTimeout(r, (d.seconds ?? 2) * 1000))
        const next = flow.getNextNodes(node.id)
        return next[0]?.id ?? null
      }

      case 'tag_lead': {
        if (lead) {
          const data = node.data as TagLeadNodeData
          for (const tag of (data.add ?? [])) {
            const resolved = this.interpolate(tag, conversation.variables)
            lead.addTag(resolved)
            this.emit(bot.id, conversation.id, conversation.phoneNumber, 'tag_added', { tag: resolved })
          }
          for (const tag of (data.remove ?? [])) {
            const resolved = this.interpolate(tag, conversation.variables)
            lead.removeTag(resolved)
            this.emit(bot.id, conversation.id, conversation.phoneNumber, 'tag_removed', { tag: resolved })
          }
          conversation.setVariable('__lead_tags', lead.tags.join(','))
        }
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'ai_validate_receipt': {
        const data = node.data as AIValidateReceiptNodeData
        const imageBase64 = conversation.variables['__imageBase64']
        const intentVar = data.paymentIntentVariable || '__rt_checkout_payment_id'
        let paymentIntentId = conversation.variables[intentVar]

        // Self-heal: the customer reached receipt capture via a shortcut path
        // (pix_pending / payment_receipt) that skipped checkout, so no intent was
        // created. Reconstruct one from context so the bot can validate on its own.
        if (imageBase64 && !paymentIntentId && this.paymentIntentRepo) {
          const pending = await this.paymentIntentRepo.findPendingByConversation(conversation.id)
          if (pending) {
            // An intent already exists (var got lost) — just rebind it.
            paymentIntentId = pending.id
            console.log(`[FlowExecution] ai_validate_receipt: rebound pending intent=${pending.id} for ${phone}`)
          } else {
            // No intent, but if there's a cart we know the amount → create one now.
            const cart = Cart.fromVariables(conversation.variables)
            const receiverKey = bot.globalConfig?.defaultPixKey ?? ''
            const receiverName = bot.globalConfig?.defaultReceiverName ?? ''
            if (!cart.isEmpty && receiverKey) {
              const offers = this.packageOfferRepo ? await this.packageOfferRepo.findByBotId(bot.id) : []
              const pricing = PricingService.calculate(cart, offers)
              const intent = PaymentIntent.create({
                botId: bot.id,
                leadId: lead?.id ?? conversation.phoneNumber,
                conversationId: conversation.id,
                amount: pricing.finalTotalCentavos,
                receiverKey,
                receiverName,
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              })
              await this.paymentIntentRepo.save(intent)
              paymentIntentId = intent.id
              console.log(`[FlowExecution] ai_validate_receipt: lazy-created intent=${intent.id} (${pricing.finalTotalCentavos}c) from cart for ${phone}`)
            }
          }
          if (paymentIntentId) {
            conversation.setVariable(intentVar, paymentIntentId)
            conversation.setVariable('__rt_checkout_payment_id', paymentIntentId)
          }
        }

        // A receipt with an image but still no PaymentIntent means there is no cart
        // and no amount to validate against. NEVER tell a paying customer their
        // receipt is invalid here — escalate to a human instead.
        if (imageBase64 && !paymentIntentId) {
          console.warn('[FlowExecution] ai_validate_receipt: receipt image but no paymentIntentId — escalating to human (no false rejection)')
          conversation.setVariable('__imageBase64', '') // consume
          // Persiste o handoff ANTES de prometer ao cliente e SEM engolir o erro: se o save falhar, a exceção
          // propaga, a fila re-tenta (idempotente) e a promessa "vou confirmar" NÃO é dada sem registro.
          await this.createHandoff({ bot, conversation, lead, reason: 'pix_failed', lastMessage: conversation.getLastUserMessage() ?? '[comprovante sem pedido]' })
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: 'Recebi seu comprovante aqui! 🙏 Só vou confirmar com a equipe e já te retorno, tá? Pode deixar que não vou te deixar na mão.' })
          const ownerPhone = bot.globalConfig?.ownerPhone
          if (ownerPhone) {
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: ownerPhone, message: `⚠️ Comprovante recebido SEM pedido vinculado de ${conversation.phoneNumber}. Cliente pode ter pago — confirme manualmente.` }).catch(() => {})
          }
          conversation.handoff()
          lead?.addTag('needs_human')
          return undefined
        }

        if (!imageBase64 || !paymentIntentId || !this.paymentOrchestrator) {
          console.warn('[FlowExecution] ai_validate_receipt: missing image, intentId, or orchestrator — routing to rejected')
          const rejected = flow.getNextNodes(node.id, 'rejected')
          return rejected[0]?.id ?? undefined
        }

        conversation.setVariable('__imageBase64', '') // consume

        const result = await this.paymentOrchestrator.processReceipt({
          botId: bot.id,
          conversationId: conversation.id,
          phoneNumber: conversation.phoneNumber,
          imageBase64,
          paymentIntentId,
          tolerances: {
            underCentavos: bot.globalConfig?.pixToleranceUnderCentavos,
            overCentavos: bot.globalConfig?.pixToleranceOverCentavos ?? null,
          },
        })

        conversation.setVariable('__validation_reason', result.decision.reason)
        conversation.setVariable('__validation_approved', result.decision.approved ? 'true' : 'false')

        // Comprovante APROVADO → persiste vinculado ao PaymentIntent (o pedido X) e
        // anexa a bolha de aprovação com a imagem na conversa (auditoria + tela).
        // Upsell/nova venda cria intent novo → arquivo novo; nada sobrescreve.
        if (result.decision.approved) {
          try {
            const dir = joinPath(RECEIPTS_DIR, bot.id)
            mkdirSync(dir, { recursive: true })
            writeFileSync(joinPath(dir, `${paymentIntentId}.jpg`), Buffer.from(imageBase64, 'base64'))
            conversation.addAssistantMessage(
              `✅ Comprovante aprovado · pedido ${paymentIntentId.slice(0, 8)}`,
              { type: 'image', url: `/api/receipts/${bot.id}/${paymentIntentId}`, filename: `comprovante-${paymentIntentId.slice(0, 8)}.jpg` },
            )
            this.emit(bot.id, conversation.id, conversation.phoneNumber, 'receipt_saved' as never, { paymentIntentId })
          } catch (err) {
            console.error('[ai_validate_receipt] falha ao salvar comprovante (validação segue):', (err as Error)?.message)
          }
        }

        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: result.userMessage })

        if (!result.decision.approved) {
          const failCount = parseInt(conversation.variables['__rt_receipt_fail_count'] ?? '0', 10)
          const newCount = failCount + 1
          conversation.setVariable('__rt_receipt_fail_count', String(newCount))
          if (newCount >= 2) {
            this.createHandoff({ bot, conversation, lead, reason: 'pix_failed', lastMessage: conversation.getLastUserMessage() ?? '' }).catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
          }

          const ownerPhone = bot.globalConfig?.ownerPhone
          if (ownerPhone) {
            // Notify owner when amount doesn't match (paid more or less than expected)
            if (result.decision.reason === 'amount_mismatch') {
              const debug = result.decision.debugInfo ?? {}
              const paid = debug['extracted'] != null
                ? `R$ ${(Number(debug['extracted']) / 100).toFixed(2)}`
                : '?'
              const expected = debug['expected'] != null
                ? `R$ ${(Number(debug['expected']) / 100).toFixed(2)}`
                : '?'
              const diff = debug['diffCentavos'] != null
                ? Number(debug['diffCentavos']) / 100
                : null
              const diffStr = diff != null
                ? diff > 0 ? `pagou R$ ${diff.toFixed(2)} a mais` : `pagou R$ ${Math.abs(diff).toFixed(2)} a menos`
                : 'valor divergente'
              await this.messaging.sendMessage({
                instanceName: instance, instanceId, phoneNumber: ownerPhone,
                message: `⚠️ *Valor divergente* — ${phone}\nEsperado: ${expected} | Recebido: ${paid} (${diffStr})\nConversa: ${conversation.id.slice(0, 8)}`,
              }).catch(e => console.error('[FlowExecution] owner amount_mismatch notify failed:', e?.message))
            }

            // Notify owner on 2nd+ invalid receipt — first attempt may be an innocent mistake
            if (result.decision.reason === 'invalid_receipt' && newCount >= 2) {
              await this.messaging.sendMessage({
                instanceName: instance, instanceId, phoneNumber: ownerPhone,
                message: `🚨 *Tentativa de golpe detectada* — ${phone}\nA imagem enviada não é um comprovante Pix.\nCarrinho: ${lead?.tags.includes('buyer') ? 'comprador recorrente' : 'novo usuário'} | Conversa: ${conversation.id.slice(0, 8)}\n\nFique atento a este contato.`,
              }).catch(e => console.error('[FlowExecution] owner fraud notify failed:', e?.message))
              console.log(`[FES:fraud_alert] phone="${phone}" reason="invalid_receipt" ownerNotified="${ownerPhone}"`)
            }
          }
        }
        const handle = result.decision.approved ? 'approved' : 'rejected'
        const next = flow.getNextNodes(node.id, handle)
        return next[0]?.id ?? undefined
      }

      case 'payment_confirmed': {
        const data = node.data as PaymentConfirmedNodeData
        if (lead) {
          lead.recordPaymentConfirmed()
          conversation.setVariable('__lead_tags', lead.tags.join(','))
        }
        this.transitionPhase(conversation, 'post_purchase', 'payment_confirmed')
        this.observationRepo?.updateOutcomeByConversation(conversation.id, 'success').catch(e => console.error('[FES] outcome success failed:', e?.message))
        console.log(`[FlowExecution] payment_confirmed for ${conversation.phoneNumber}`)

        // Commerce: create Order from cart and deliver access links
        if (this.orderRepo && this.deliveryService) {
          const cart = Cart.fromVariables(conversation.variables)
          if (!cart.isEmpty) {
            const paymentIntentId = conversation.variables['__rt_checkout_payment_id']
              ?? conversation.variables['paymentIntentId']
              ?? ''
            const order = Order.create({
              botId: bot.id,
              leadId: lead?.id ?? conversation.phoneNumber,
              conversationId: conversation.id,
              paymentIntentId,
              items: cart.items,
            })
            order.markPaid()
            const { delivered, failed, pending } = await this.deliveryService.deliver(order, phone, instance, instanceId)
            const ownerPhone = bot.globalConfig?.ownerPhone
            if (pending.length > 0) {
              order.markDeliveryPending()
              if (ownerPhone) {
                const pendingNames = pending.map(i => i.name).join(', ')
                await this.messaging.sendMessage({
                  instanceName: instance, instanceId, phoneNumber: ownerPhone,
                  message: `⚠️ Pedido ${order.id.slice(0, 8)} tem itens sem link de entrega: ${pendingNames}`,
                }).catch(e => console.error('[FlowExecution] owner pending notify failed:', e?.message))
              }
            }
            if (failed.length > 0) {
              if (ownerPhone) {
                const failedNames = failed.map(i => i.name).join(', ')
                await this.messaging.sendMessage({
                  instanceName: instance, instanceId, phoneNumber: ownerPhone,
                  message: `🚨 *Falha na entrega* — pedido ${order.id.slice(0, 8)}\nItens não enviados: ${failedNames}\nCliente: ${phone}\n\nVerifique e reenvie manualmente.`,
                }).catch(e => console.error('[FlowExecution] owner delivery_failed notify failed:', e?.message))
              }
              console.error(`[FES:delivery_failed] orderId="${order.id}" phone="${phone}" failed=${JSON.stringify(failed.map(i => i.name))}`)
            }
            if (pending.length === 0 && failed.length === 0 && delivered.length > 0) {
              order.markDelivered()
              if (ownerPhone) {
                const itemNames = delivered.map(i => i.name).join('\n• ')
                const totalBrl = (order.totalCentavos / 100).toFixed(2).replace('.', ',')
                await this.messaging.sendMessage({
                  instanceName: instance, instanceId, phoneNumber: ownerPhone,
                  message: `✅ *Venda confirmada!*\n\nCliente: ${phone}\nItens:\n• ${itemNames}\nTotal: R$ ${totalBrl}\nPedido: ${order.id.slice(0, 8)}`,
                }).catch(e => console.error('[FlowExecution] owner sale notify failed:', e?.message))
              }
            }
            await this.orderRepo.save(order)
            this.emit(bot.id, conversation.id, phone, 'order_created', {
              orderId: order.id, total: order.totalCentavos, status: order.status,
            })
            // Clear cart after successful delivery
            if (pending.length === 0) {
              for (const key of Cart.clearKeys()) conversation.setVariable(key, '')
              this.emit(bot.id, conversation.id, phone, 'cart_cleared', { reason: 'order_completed' })
            }
          }
        }

        this.emit(bot.id, conversation.id, conversation.phoneNumber, 'flow_completed', {
          reason: 'payment_confirmed',
          phase: 'post_purchase',
        })
        if (data.confirmationMessage) {
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: data.confirmationMessage })
        }
        if (data.postPurchaseMessage) {
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: data.postPurchaseMessage })
        }
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'catalog_search': {
        const data = node.data as CatalogSearchNodeData
        // __rt_router_candidate_query has highest priority — set by ai_router for title/partial searches
        const candidateOverride = conversation.variables['__rt_router_candidate_query']
        if (candidateOverride) delete conversation.variables['__rt_router_candidate_query']

        const queryFromVar = candidateOverride
          ?? (data.searchFrom ? (conversation.variables[data.searchFrom] ?? '') : '')
        const query = queryFromVar || (conversation.getLastUserMessage() ?? '')
        flog('catalog_search', { nodeId: node.id, query: query.slice(0, 80), candidateOverride: candidateOverride ?? null, searchFrom: data.searchFrom ?? null })

        conversation.setVariable('__rt_search_query', query)
        this.transitionPhase(conversation, 'browsing_catalog', 'catalog_search_node')

        if (!this.catalogSearchService) {
          console.warn('[FlowExecution] catalog_search: no CatalogSearchService — routing not_found')
          return flow.getNextNodes(node.id, 'not_found')[0]?.id
        }

        const result = await this.catalogSearchService.search(bot.id, query, { botId: bot.id, conversationId: conversation.id, phoneNumber: phone }, { genreSearch: bot.globalConfig?.catalogGenreSearch === true })
        this.emit(bot.id, conversation.id, phone, 'catalog_searched', {
          query, found: result.products.length, unresolved: result.unresolved.length,
        })

        if (result.products.length === 0) {
          flog('catalog_search:result', { query: query.slice(0, 80), found: 0, unresolved: result.unresolved, decision: 'not_found' })
          flog('analytics:search', {
            layer: 'business_analytics',
            event: 'title_not_found',
            requestedTitle: query.slice(0, 80),
            phone,
          })
          conversation.setVariable('__rt_has_unresolved', 'true')
          conversation.setVariable('__rt_search_unresolved', JSON.stringify(result.unresolved))
          this.emit(bot.id, conversation.id, phone, 'product_not_found', { query, unresolved: result.unresolved })

          // #not-found gracioso (mata a causa dos 46 series_not_found): em vez de escalar de cara,
          // oferece os títulos mais próximos + pede nome/link, e SÓ escala após 2 tentativas seguidas.
          const ndCount = Number(conversation.variables['__rt_notfound_count'] ?? 0) + 1
          conversation.setVariable('__rt_notfound_count', String(ndCount))
          const instance = bot.evolutionConfig.instanceName
          const instanceId = bot.evolutionConfig.instanceId

          if (ndCount < 2) {
            const sugg = (result.suggestions ?? []).filter(Boolean).slice(0, 3)
            const sugLines = sugg.length ? `\n\nVocê quis dizer alguma dessas? 👇\n${sugg.map(s => `• ${s}`).join('\n')}` : ''
            const msg = `Hmm, não achei *"${query.slice(0, 60)}"* exatamente 😅${sugLines}\n\nMe manda o *nome certinho* (ou o print/link do anúncio) que eu procuro pra você 🔎`
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
            conversation.addAssistantMessage(msg)
            // volta pra captura principal: a próxima mensagem (nome melhor / uma das sugestões) re-busca.
            const mainCap = this.findMainCaptureNodeId(flow)
            if (mainCap) conversation.moveToNode(mainCap)
            await this.convRepo.save(conversation)
            return
          }
          // 2+ tentativas sem achar → escala pro humano (cliente realmente não acha).
          conversation.setVariable('__rt_notfound_count', '0')
          this.createHandoff({ bot, conversation, lead, reason: 'series_not_found', lastMessage: query }).catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
          return flow.getNextNodes(node.id, 'not_found')[0]?.id
        }

        conversation.setVariable('__rt_notfound_count', '0') // achou → zera o contador do not-found gracioso

        // Only the top result per search action — avoids adding multiple products for vague queries
        const top = result.products[0]
        flog('catalog_search:result', { query: query.slice(0, 80), found: result.products.length, topProduct: top.product.name, confidence: top.confidence, unresolved: result.unresolved.length, decision: 'found' })

        // #7 Anti-hallucination: compare what the AI extracted vs what DB matched.
        // Only meaningful for full title searches (≥3 words). Keyword queries (e.g. "doutor")
        // will never literally match the product name — skip to avoid false positives.
        const aiSuggestedTitle = top.searchQuery?.trim() ?? query
        const catalogMatchedTitle = top.product.name
        const isFullTitleSearch = aiSuggestedTitle.split(/\s+/).filter(Boolean).length >= 3
        if (isFullTitleSearch && aiSuggestedTitle.toLowerCase() !== catalogMatchedTitle.toLowerCase()) {
          flog('antihallucination:catalog', {
            layer: 'anti_hallucination',
            aiSuggestedTitle,
            catalogMatchedTitle,
            confidence: top.confidence,
            divergent: true,
            alert: top.confidence < 0.85 ? 'LOW_CONFIDENCE_MISMATCH' : null,
            query: query.slice(0, 80),
          })
        }

        // #10 Business analytics: track requested title
        flog('analytics:search', {
          layer: 'business_analytics',
          event: 'title_found',
          requestedTitle: query.slice(0, 80),
          matchedTitle: catalogMatchedTitle,
          confidence: top.confidence,
          phone,
        })
        const foundItems: CartItem[] = [{
          productId: top.product.id,
          name: top.product.name,
          priceCentavos: top.product.priceCentavos,
          accessLink: top.product.accessLink,
        }]
        conversation.setVariable('__rt_catalog_found', JSON.stringify(foundItems))
        conversation.setVariable('__rt_last_added_name', top.product.name)
        conversation.setVariable('__rt_has_unresolved', result.unresolved.length > 0 ? 'true' : 'false')
        conversation.setVariable('__rt_search_unresolved', JSON.stringify(result.unresolved))

        if (result.unresolved.length > 0) {
          this.emit(bot.id, conversation.id, phone, 'product_not_found', {
            query, unresolved: result.unresolved,
          })
        }

        return flow.getNextNodes(node.id, 'found')[0]?.id
      }

      case 'cart_add': {
        const _data = node.data as CartAddNodeData
        const foundRaw = conversation.variables['__rt_catalog_found']
        if (!foundRaw) {
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        let items: CartItem[]
        try {
          items = JSON.parse(foundRaw) as CartItem[]
        } catch {
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        const cart = Cart.fromVariables(conversation.variables)
        try {
          cart.addItems(items)
        } catch (err) {
          conversation.setVariable('__rt_cart_add_error', err instanceof Error ? err.message : 'Cart limit exceeded')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        const vars = cart.toVariables()
        for (const [k, v] of Object.entries(vars)) conversation.setVariable(k, v)

        this.emit(bot.id, conversation.id, phone, 'product_added_to_cart', {
          count: items.length, cartTotal: cart.totalCentavos, cartCount: cart.count,
        })
        this.transitionPhase(conversation, 'building_cart', 'cart_add_success')
        flog('analytics:cart', {
          layer: 'business_analytics',
          event: 'item_added',
          itemCount: items.length,
          cartCount: cart.count,
          cartTotalCentavos: cart.totalCentavos,
          items: items.map(i => i.name),
          phone,
        })
        return flow.getNextNodes(node.id, 'success')[0]?.id ?? flow.getNextNodes(node.id)[0]?.id
      }

      case 'cart_summary': {
        const data = node.data as CartSummaryNodeData
        const cart = Cart.fromVariables(conversation.variables)

        // Idempotency: if checkout already created a PaymentIntent for this conversation
        // (job-retry scenario), skip resending the cart summary and proceed silently
        if (this.paymentIntentRepo) {
          const existingForSummary = await this.paymentIntentRepo.findPendingByConversation(conversation.id)
          if (existingForSummary) {
            flog('dedup:cart_summary', { layer: 'dedup', nodeId: node.id, existingIntentId: existingForSummary.id, duplicatePrevented: true })
            console.log(`[cart_summary] skipping resend — pending intent=${existingForSummary.id} already exists`)
            return flow.getNextNodes(node.id)[0]?.id
          }
        }

        // Empty cart guard — never show summary with 0 items
        if (cart.isEmpty) {
          console.log('[cart_summary] cart is empty — sending guidance instead')
          await this.messaging.sendMessage({
            instanceName: instance, instanceId, phoneNumber: phone,
            message: 'Seu carrinho ainda está vazio 😅 Me fala o que você quer adicionar!',
          })
          conversation.addAssistantMessage('Seu carrinho ainda está vazio 😅 Me fala o que você quer adicionar!')
          // Route back to capture — never through output (which leads to checkout)
          return flow.getNextNodes(node.id, 'empty')[0]?.id
            ?? flow.nodes.find(n => n.type === 'capture' && n.id.includes('main'))?.id
            ?? undefined
        }

        // Run PricingService — PackageOffer is a pricing layer, NOT a product
        const offers = this.packageOfferRepo ? await this.packageOfferRepo.findByBotId(bot.id) : []
        const pricing = PricingService.calculate(cart, offers)
        const pricingVars = PricingService.toPricingVars(pricing)

        // Persist pricing vars so checkout and downstream nodes can read them
        for (const [k, v] of Object.entries(pricingVars)) conversation.setVariable(k, v)

        const hasDiscount = pricing.discountCentavos > 0
        const defaultTemplate = hasDiscount
          ? `🛒 *Seu pedido:*\n\n${cart.toSummaryLines().join('\n')}\n\n📦 ${pricing.itemCount} item${pricing.itemCount !== 1 ? 's' : ''}\n💰 Valor original: ${PricingService.formatBRL(pricing.originalTotalCentavos)}\n🎁 Pacote: ${pricing.appliedOfferName}\n✂️ Desconto: ${PricingService.formatBRL(pricing.discountCentavos)}\n\n✅ *Total final: ${PricingService.formatBRL(pricing.finalTotalCentavos)}*`
          : `🛒 *Seu carrinho* (${cart.count} item${cart.count !== 1 ? 's' : ''}):\n\n${cart.toSummaryLines().join('\n')}\n\n💰 *Total: ${cart.totalInBRL}*`

        const template = data.messageTemplate ?? defaultTemplate
        const msg = this.interpolate(template, { ...conversation.variables, ...cart.toVariables(), ...pricingVars })
        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
        return flow.getNextNodes(node.id)[0]?.id
      }

      case 'checkout': {
        const data = node.data as CheckoutNodeData
        const cart = Cart.fromVariables(conversation.variables)

        if (cart.isEmpty) {
          console.warn('[FlowExecution] checkout: cart is empty')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        if (!this.paymentIntentRepo) {
          console.warn('[FlowExecution] checkout: no paymentIntentRepo')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        const receiverKey = data.receiverKey ?? bot.globalConfig?.defaultPixKey ?? ''
        const receiverName = data.receiverName ?? bot.globalConfig?.defaultReceiverName ?? ''

        if (!receiverKey) {
          console.warn('[FlowExecution] checkout: no receiverKey configured')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        try {
          // PricingService: PackageOffer is a pricing layer only — Product remains delivery source of truth
          const offers = this.packageOfferRepo ? await this.packageOfferRepo.findByBotId(bot.id) : []
          const pricing = PricingService.calculate(cart, offers)
          const pricingVars = PricingService.toPricingVars(pricing)
          for (const [k, v] of Object.entries(pricingVars)) conversation.setVariable(k, v)

          // Idempotency: if a pending intent already exists for this conversation (job retry scenario),
          // re-use it instead of creating a duplicate
          const existingIntent = await this.paymentIntentRepo.findPendingByConversation(conversation.id)
          let intent: PaymentIntent
          if (existingIntent) {
            flog('dedup:checkout', { layer: 'dedup', nodeId: node.id, existingIntentId: existingIntent.id, duplicatePrevented: true })
            console.log(`[checkout] reusing existing intent=${existingIntent.id} for conv=${conversation.id}`)
            intent = existingIntent
          } else {
            const expiresAt = new Date(Date.now() + (data.expiresInMinutes ?? 60) * 60 * 1000)
            intent = PaymentIntent.create({
              botId: bot.id,
              leadId: lead?.id ?? conversation.phoneNumber,
              conversationId: conversation.id,
              amount: pricing.finalTotalCentavos,
              receiverKey,
              receiverName,
              expiresAt,
            })
            await this.paymentIntentRepo.save(intent)
          }

          const outputVar = data.outputVariable ?? '__rt_checkout_payment_id'
          conversation.setVariable(outputVar, intent.id)
          conversation.setVariable('__rt_checkout_payment_id', intent.id)

          // Only send PIX message if this is a fresh intent (not a retry re-using an existing one)
          if (!existingIntent) {
            const finalAmountBrl = PricingService.formatBRL(pricing.finalTotalCentavos)
            const hasDiscount = pricing.discountCentavos > 0
            const discountLine = hasDiscount
              ? `\n_Pacote aplicado: ${pricing.appliedOfferName} — desconto de ${PricingService.formatBRL(pricing.discountCentavos)}_`
              : ''
            const pixTemplate = data.pixMessage
              ?? `💳 *Pagamento via Pix*\n\nValor: *${finalAmountBrl}*\nFavorecido: ${receiverName}${discountLine}\n\n_Copie a chave abaixo e realize o pagamento no seu banco._`
            const pixMsg = this.interpolate(pixTemplate, {
              ...conversation.variables,
              ...pricingVars,
              amount: finalAmountBrl,
              pixKey: receiverKey,
              pixName: receiverName,
            })
            conversation.setVariable('__rt_checkout_pix_key', receiverKey)
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: pixMsg })
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: receiverKey })
            conversation.addAssistantMessage(pixMsg)  // #fix history-drift: IA precisa saber que o PIX foi enviado
          }

          this.emit(bot.id, conversation.id, phone, 'checkout_initiated', {
            paymentIntentId: intent.id,
            originalAmount: pricing.originalTotalCentavos,
            finalAmount: pricing.finalTotalCentavos,
            discountAmount: pricing.discountCentavos,
            appliedOffer: pricing.appliedOfferName,
            items: cart.count,
          })
          this.emit(bot.id, conversation.id, phone, 'payment_requested', {
            paymentIntentId: intent.id, amount: pricing.finalTotalCentavos, receiverKey,
          })
          this.transitionPhase(conversation, 'awaiting_payment', 'checkout_pix_sent')
          flog('analytics:checkout', {
            layer: 'business_analytics',
            event: 'checkout_initiated',
            paymentIntentId: intent.id,
            finalAmountBrl: pricing.finalTotalCentavos / 100,
            itemCount: cart.count,
            discountApplied: pricing.discountCentavos > 0,
            phone,
          })
          return flow.getNextNodes(node.id, 'success')[0]?.id
        } catch (err) {
          console.error('[FlowExecution] checkout error:', err)
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }
      }

      case 'package_pix': {
        const data = node.data as PackagePixNodeData
        const raw = conversation.variables[data.quantityVariable] ?? ''
        const qty = this.extractQuantity(raw)

        if (!qty || qty < 1) {
          conversation.setVariable('__rt_package_pix_error', `Não consegui entender a quantidade: "${raw}"`)
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        const unitPrice = data.unitPriceCentavos ?? 600
        const receiverKey = data.pixKey ?? bot.globalConfig?.defaultPixKey ?? ''
        const receiverName = data.recipientName ?? bot.globalConfig?.defaultReceiverName ?? ''

        if (!receiverKey) {
          conversation.setVariable('__rt_package_pix_error', 'Chave Pix não configurada')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        if (!this.paymentIntentRepo) {
          conversation.setVariable('__rt_package_pix_error', 'PaymentIntentRepository não disponível')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        try {
          const offers = this.packageOfferRepo ? await this.packageOfferRepo.findByBotId(bot.id) : []
          const pricing = PricingService.calculateFromCount(qty, unitPrice, offers)
          const pricingVars = PricingService.toPricingVars(pricing)
          for (const [k, v] of Object.entries(pricingVars)) conversation.setVariable(k, v)
          conversation.setVariable('__rt_package_quantity', String(qty))
          conversation.setVariable('__rt_purchased_slots', String(qty))
          conversation.setVariable('__rt_remaining_slots', String(qty))
          conversation.setVariable('__rt_delivered_slots', '0')

          // Idempotency: reuse existing pending intent on job retry
          const existingPkgIntent = await this.paymentIntentRepo.findPendingByConversation(conversation.id)
          let pkgIntent: PaymentIntent
          if (existingPkgIntent) {
            flog('dedup:package_pix', { layer: 'dedup', nodeId: node.id, existingIntentId: existingPkgIntent.id, duplicatePrevented: true })
            console.log(`[package_pix] reusing existing intent=${existingPkgIntent.id} for conv=${conversation.id}`)
            pkgIntent = existingPkgIntent
          } else {
            const expiresAt = new Date(Date.now() + (data.expiresInMinutes ?? 60) * 60 * 1000)
            pkgIntent = PaymentIntent.create({
              botId: bot.id,
              leadId: lead?.id ?? conversation.phoneNumber,
              conversationId: conversation.id,
              amount: pricing.finalTotalCentavos,
              receiverKey,
              receiverName,
              expiresAt,
            })
            await this.paymentIntentRepo.save(pkgIntent)
          }

          const outputVar = data.outputVariable ?? 'paymentIntentId'
          conversation.setVariable(outputVar, pkgIntent.id)

          if (!existingPkgIntent) {
            const finalBrl = PricingService.formatBRL(pricing.finalTotalCentavos)
            const hasDiscount = pricing.discountCentavos > 0
            const offerLine = hasDiscount
              ? `\n_${pricing.appliedOfferName}: ${PricingService.formatBRL(pricing.originalTotalCentavos)} → *${finalBrl}*_`
              : ''
            const pixMsg = `💳 *Pagamento via Pix*\n\nValor: *${finalBrl}*\nFavorecido: ${receiverName}${offerLine}\n\n_Copie a chave abaixo e pague no seu banco. Depois me envie o comprovante 🚀_`
            conversation.setVariable('__rt_checkout_pix_key', receiverKey)
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: pixMsg })
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: receiverKey })
            conversation.addAssistantMessage(pixMsg)  // #fix history-drift: IA precisa saber que o PIX foi enviado
          }

          this.emit(bot.id, conversation.id, phone, 'payment_requested', {
            paymentIntentId: pkgIntent.id, amount: pricing.finalTotalCentavos, receiverKey,
          })
          this.transitionPhase(conversation, 'awaiting_payment', 'package_pix_sent')
          return flow.getNextNodes(node.id, 'success')[0]?.id
        } catch (err) {
          console.error('[FlowExecution] package_pix error:', err)
          conversation.setVariable('__rt_package_pix_error', String(err))
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }
      }

      case 'classify_intent': {
        const data = node.data as ClassifyIntentNodeData

        console.log(`[classify_intent] start — phone=${conversation.phoneNumber} node=${node.id}`)

        // Catalog paste guard — runs before any classification
        {
          const rawText = data.messageVariable
            ? (conversation.variables[data.messageVariable] ?? '')
            : (conversation.getLastUserMessage() ?? '')

          // Webapp selection: "Olá! Gostaria dessas minisséries: • Title1 • Title2 Desejo essas minisséries!"
          if (this.isWebappSelection(rawText)) {
            console.log(`[classify_intent] webapp_selection detected — routing to ai_check: "${rawText.slice(0, 80)}"`)
            return flow.getNextNodes(node.id, 'ai_check')[0]?.id ?? null
          }

          if (this.isCatalogPaste(rawText)) {
            console.log('[classify_intent] catalog_paste detected — sending guidance')
            await this.messaging.sendMessage({
              instanceName: bot.evolutionConfig.instanceName,
              instanceId: bot.evolutionConfig.instanceId,
              phoneNumber: conversation.phoneNumber,
              message: 'Vi que você colou uma lista do catálogo 😊 Me fala só o nome do item que você quer, ou pode mandar mais de um separado por vírgula.',
            })
            return null
          }
        }

        // ── Contextual yes/no interception ─────────────────────────────────
        // Must run before runConfiguredRules so "sim"/"não" isn't swallowed by greeting patterns
        {
          const rawText = data.messageVariable
            ? (conversation.variables[data.messageVariable] ?? '')
            : (conversation.getLastUserMessage() ?? '')
          const isYes = this.isYesMessage(rawText)
          const isNo = this.isNoMessage(rawText)

          if (isYes || isNo) {
            const lastBotMsg = [...conversation.history].reverse().find(m => m.role === 'assistant')?.content ?? null
            const qType = this.detectBotQuestionType(lastBotMsg)
            const cart = Cart.fromVariables(conversation.variables)
            const instance = bot.evolutionConfig.instanceName
            const instanceId = bot.evolutionConfig.instanceId
            const phone = conversation.phoneNumber

            if (qType === 'want_more_items') {
              if (isYes) {
                // Ambiguous: "sim" after "Quer mais alguma? Ou pode cobrar" could mean more items OR pay.
                // Let the AI router decide with full conversation context.
                console.log(`[classify_intent] yes_no_context: want_more_items+yes → ai_check (ambiguous)`)
                return flow.getNextNodes(node.id, 'ai_check')[0]?.id ?? null
              } else {
                // User is done → go to checkout if cart has items
                if (!cart.isEmpty) {
                  console.log(`[classify_intent] yes_no_context: want_more_items+no → pay (cart=${cart.count})`)
                  conversation.setVariable('__rt_yes_no_context', 'want_more_no')
                  return flow.getNextNodes(node.id, 'pay')[0]?.id ?? null
                }
                // Cart empty — ask what they want
                const msg = 'Certo 😊 Pode me falar o que você quer?'
                await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
                conversation.addAssistantMessage(msg)
                return null
              }
            }

            if (qType === 'confirm_checkout') {
              if (isYes && !cart.isEmpty) {
                console.log(`[classify_intent] yes_no_context: confirm_checkout+yes → pay`)
                conversation.setVariable('__rt_yes_no_context', 'confirm_checkout_yes')
                return flow.getNextNodes(node.id, 'pay')[0]?.id ?? null
              }
              // "não" after checkout offer — fall through to AI router to handle gracefully
            }

            if (qType === 'unknown') {
              // Pure yes/no with no identifiable question context → ask for clarification
              const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length
              if (wordCount <= 2) {
                console.log(`[classify_intent] yes_no_context: unknown+${isYes ? 'yes' : 'no'} → clarification`)
                const msg = 'Certo 😊 Pode me falar o que você quer?'
                await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
                conversation.addAssistantMessage(msg)
                return null
              }
            }
          }
        }

        // P3 fast path — trigger pre-classified, reuse result
        if (conversation.variables['__rt_pre_classified'] === 'true') {
          conversation.setVariable('__rt_pre_classified', 'false')
          const intent = conversation.variables['__rt_intent'] ?? 'unknown'
          // Try the exact handle first, then legacy mapping
          const directEdge = flow.getNextNodes(node.id, intent)[0]
          const handle = this.guardReceiptHandle(directEdge ? intent : this.intentToHandle(intent), conversation)
          console.log(`[classify_intent] p3_fast_path: intent=${intent} handle=${handle}`)
          return flow.getNextNodes(node.id, handle)[0]?.id ?? flow.getNextNodes(node.id, 'unknown')[0]?.id
        }

        const text = data.messageVariable
          ? (conversation.variables[data.messageVariable] ?? '')
          : (conversation.getLastUserMessage() ?? '')

        // ── Checkout context shortcut ──────────────────────────────────────
        // Short message after bot offered checkout with non-empty cart
        // → pay directly, no AI needed, covers all slang/affirmatives
        {
          const cart = Cart.fromVariables(conversation.variables)
          const lastBotMsg = [...conversation.history].reverse().find(m => m.role === 'assistant')?.content ?? ''
          const botOfferedCheckout = ['pode cobrar', 'gero o pix', 'gerar o pix', 'fechar pedido', 'finalizar'].some(s => lastBotMsg.toLowerCase().includes(s))
          const wordCount = text.trim().split(/\s+/).filter(Boolean).length
          const QUESTION_WORDS = ['como', 'quando', 'onde', 'quanto', 'qual', 'quem', 'porque', 'por que', 'o que']
          const isQuestion = text.includes('?') || QUESTION_WORDS.some(q => text.toLowerCase().startsWith(q))
          const NEGATIVES = ['não', 'nao', 'nope', 'nunca', 'neg']
          const isNegative = NEGATIVES.some(n => text.toLowerCase().trim() === n || text.toLowerCase().startsWith(n + ' '))

          if (!cart.isEmpty && botOfferedCheckout && wordCount <= 4 && !isQuestion && !isNegative) {
            console.log(`[classify_intent] checkout_context_shortcut: "${text.slice(0, 40)}" (${wordCount}w, cart=${cart.count})`)
            return flow.getNextNodes(node.id, 'pay')[0]?.id ?? undefined
          }
        }

        // ── Step 1: run configurable rules from node data ──────────────────
        console.log(`[classify_intent] step1_rules: text="${text.slice(0, 80)}" intents=${data.intents?.length ?? 0}`)
        const ruleMatch = data.intents?.length
          ? this.runConfiguredRules(text, data.intents)
          : null

        if (ruleMatch) {
          conversation.setVariable('__rt_intent', ruleMatch.handle)
          conversation.setVariable('__rt_confidence', String(ruleMatch.confidence))
          if (ruleMatch.quantityDetected !== null)
            conversation.setVariable('__rt_quantity_detected', String(ruleMatch.quantityDetected))
          if (ruleMatch.titleDetected)
            conversation.setVariable('__rt_title_detected', ruleMatch.titleDetected)

          // Fraud/support patterns: send reassurance, create handoff (suspend — not end)
          if (ruleMatch.handle === 'price_issue') {
            console.log(`[classify_intent] fraud_detected: creating handoff (not end_service) for ${conversation.phoneNumber}`)
            const msg = 'Entendo! Deixa eu ver o que posso fazer por você 🙏 Vou falar com o pessoal aqui, em instantes alguém te retorna!'
            await this.messaging.sendMessage({ instanceName: bot.evolutionConfig.instanceName, instanceId: bot.evolutionConfig.instanceId, phoneNumber: conversation.phoneNumber, message: msg })
            conversation.addAssistantMessage(msg)
            this.createHandoff({ bot, conversation, lead, reason: 'fraud_accusation', lastMessage: text })
              .catch(e => console.error('[classify_intent] createHandoff failed:', e?.message))
            return null // suspend — conversation stays open for operator takeover
          }

          const guardedHandle = this.guardReceiptHandle(ruleMatch.handle, conversation)
          const nextNode = flow.getNextNodes(node.id, guardedHandle)[0]?.id ?? flow.getNextNodes(node.id, 'unknown')[0]?.id
          console.log(`[classify_intent] rule_match: handle=${guardedHandle} confidence=${ruleMatch.confidence} next=${nextNode}`)
          return nextNode
        }

        // ── Step 2: AI Agent for unmapped scenarios ────────────────────────
        console.log(`[classify_intent] step2_ai_agent: enabled=${!!data.aiAgent?.enabled} text="${text.slice(0, 80)}"`)
        if (data.aiAgent?.enabled) {
          const agentDecision = await this.runIntentAgent(text, conversation, lead, bot, data.aiAgent)
          conversation.setVariable('__rt_intent', agentDecision.handle ?? 'unknown')
          if (agentDecision.titleDetected)
            conversation.setVariable('__rt_title_detected', agentDecision.titleDetected)
          if (agentDecision.quantityDetected !== null && agentDecision.quantityDetected !== undefined)
            conversation.setVariable('__rt_quantity_detected', String(agentDecision.quantityDetected))

          if (agentDecision.action === 'respond' && agentDecision.message) {
            conversation.setVariable('__rt_ai_responded', 'true')
            await this.messaging.sendMessage({
              instanceName: bot.evolutionConfig.instanceName,
              instanceId: bot.evolutionConfig.instanceId,
              phoneNumber: conversation.phoneNumber,
              message: agentDecision.message,
            })
            console.log(`[classify_intent] ai_agent: action=respond inline="${agentDecision.message?.slice(0, 60)}"`)
            return null // stay — wait for next user message
          }

          if (agentDecision.action === 'handoff') {
            console.log(`[classify_intent] ai_agent: action=handoff reason=unknown_intent`)
            this.createHandoff({ bot, conversation, lead, reason: 'unknown_intent', lastMessage: text })
              .catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
            return flow.getNextNodes(node.id, 'unknown')[0]?.id
          }

          // action === 'route'
          const handle = this.guardReceiptHandle(agentDecision.handle ?? 'unknown', conversation)
          const nextNode = flow.getNextNodes(node.id, handle)[0]?.id ?? flow.getNextNodes(node.id, 'unknown')[0]?.id
          console.log(`[classify_intent] ai_agent: action=route handle=${handle} title="${agentDecision.titleDetected ?? ''}" next=${nextNode}`)
          return nextNode
        }

        // ── Escape hatch (IA cobre lacunas) — per-part aware, gated, default OFF (Brain/spec_escape_hatch.md) ──
        {
          const routes = (data.intents ?? [])
            .filter(r => r.handle && r.handle !== 'unknown')
            .map(r => ({ handle: r.handle, description: r.label ?? r.handle }))
          const esc = await this.runEscapeHatch(flow, conversation, lead, bot, text, routes)
          if (esc.outcome === 'answered') { conversation.setVariable('__rt_ai_responded', 'true'); return null }
          if (esc.outcome === 'routed' && esc.handle) {
            const escHandle = this.guardReceiptHandle(esc.handle, conversation)
            conversation.setVariable('__rt_intent', escHandle)
            return flow.getNextNodes(node.id, escHandle)[0]?.id ?? flow.getNextNodes(node.id, 'unknown')[0]?.id
          }
          if (esc.outcome === 'handoff') return flow.getNextNodes(node.id, 'unknown')[0]?.id
          // inactive / unknown → cai no fluxo normal abaixo
        }

        // No configured rules and no AI agent — fall through to unknown
        console.warn(`[classify_intent] no_rules_no_ai: node=${node.id} — configure data.intents[] in FlowBuilder`)
        return flow.getNextNodes(node.id, 'unknown')[0]?.id
      }

      case 'ai_router': {
        const data = node.data as import('@whatsbot/core').AiRouterNodeData

        // ── Fase 2 (gated) — ⚠️ INCOMPLETA / NÃO USAR (testada e quebrou 2026-06-15) ──
        // O ai_router NÃO é só roteador: carrega cola determinística do fluxo (contexto sim/não →
        // confirma+adiciona ao carrinho, extração multi-título, ai_router_confirm). Este branch
        // retorna no topo e PULA tudo isso → confirmação some, carrinho não enche, checkout vazio.
        // Reescrever só substituindo a CHAMADA do ContextualAIRouter (preservando a cola), OU
        // abandonar (caminho B: migrar pro agente, que não tem ai_router). Ver Brain/spec_aposentadoria_roteadores.md.
        // Default = ContextualAIRouter abaixo. Nenhum bot deve ter aiRouterMode='escape_hatch'.
        if (bot.globalConfig?.aiRouterMode === 'escape_hatch' && this.aiService) {
          const userMessage = conversation.getLastUserMessage() ?? ''
          // toggle "IA cobre lacunas" OFF → sem IA aqui, segue determinístico
          if (!bot.globalConfig?.aiGapFill?.enabled) {
            console.log('[ai_router] escape_hatch mode + aiGapFill OFF → determinístico (continue/ack)')
            return flow.getNextNodes(node.id, 'continue')[0]?.id ?? flow.getNextNodes(node.id, 'ack')[0]?.id
          }
          const HANDLE_DESC: Record<string, string> = {
            checkout: 'cliente quer finalizar/pagar/fechar o pedido', catalog: 'cliente quer ver o catálogo/lista',
            doubt: 'cliente tem dúvida sobre funcionamento, entrega, como funciona', title_search: 'cliente menciona o nome de um item pra buscar',
            ack: 'confirmação simples (ok, sim, beleza)', continue: 'seguir o fluxo, nada específico',
            price_issue: 'reclamação, fraude, problema, quer dinheiro de volta', returning_user: 'cliente retornando',
            payment_receipt: 'cliente enviou ou menciona comprovante de pagamento', negative_finish: 'cliente desistiu ou recusou', handoff: 'quer falar com humano',
          }
          const handles = [...new Set(flow.edges.filter(e => e.source === node.id && e.sourceHandle).map(e => e.sourceHandle as string))]
          const routes = handles.map(h => ({ handle: h, description: HANDLE_DESC[h] ?? h }))
          const history = conversation.history.slice(-6).map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content}`).join('\n')
          const decision = await new EscapeHatchService(this.aiService).decide({ message: userMessage, history, knowledge: bot.globalConfig?.agentKnowledge ?? '', routes, allowAnswer: true })
          console.log(`[ai_router] escape_hatch: action=${decision.action} handle=${decision.handle ?? ''}`)
          if (decision.action === 'answer' && decision.reply) {
            await this.messaging.sendMessage({ instanceName: bot.evolutionConfig.instanceName, instanceId: bot.evolutionConfig.instanceId, phoneNumber: phone, message: decision.reply })
            conversation.addAssistantMessage(decision.reply)
            return null
          }
          if (decision.action === 'route' && decision.handle) {
            return flow.getNextNodes(node.id, decision.handle)[0]?.id ?? flow.getNextNodes(node.id, 'continue')[0]?.id
          }
          if (decision.action === 'handoff') {
            this.createHandoff({ bot, conversation, lead, reason: 'unknown_intent', lastMessage: userMessage }).catch(e => console.error('[ai_router] createHandoff failed:', e?.message))
            return flow.getNextNodes(node.id, 'handoff')[0]?.id ?? flow.getNextNodes(node.id, 'continue')[0]?.id
          }
          return flow.getNextNodes(node.id, 'continue')[0]?.id ?? flow.getNextNodes(node.id, 'ack')[0]?.id
        }

        if (!this.contextualAIRouter) {
          console.warn('[ai_router] ContextualAIRouter not injected — falling through to ack')
          return flow.getNextNodes(node.id, 'ack')[0]?.id
        }

        const userMessage = conversation.getLastUserMessage() ?? ''

        // Catalog paste guard
        if (this.isCatalogPaste(userMessage)) {
          console.log('[ai_router] catalog_paste detected — sending guidance')
          await this.messaging.sendMessage({
            instanceName: bot.evolutionConfig.instanceName,
            instanceId: bot.evolutionConfig.instanceId,
            phoneNumber: phone,
            message: 'Vi que você colou uma parte do catálogo 😊 Me fala só o nome da série que você quer, ou pode mandar mais de uma separada por vírgula.',
          })
          return flow.getNextNodes(node.id, 'continue')[0]?.id ?? null
        }

        // ── Contextual yes/no — ai_router_confirm / "É essa?" ───────────────
        // Deterministic before calling Claude — context is unambiguous
        {
          const isYes = this.isYesMessage(userMessage)
          const isNo = this.isNoMessage(userMessage)
          if (isYes || isNo) {
            const lastBotMsg = [...conversation.history].reverse().find(m => m.role === 'assistant')?.content ?? null
            const qType = this.detectBotQuestionType(lastBotMsg)

            if (qType === 'confirm_suggested_title') {
              if (isYes) {
                // __rt_catalog_found is still set — cart_add node will do the actual adding
                const name = conversation.variables['__rt_last_added_name'] ?? 'produto'
                console.log(`[ai_router] yes_no_context: confirm_suggested_title+yes → ack (${name})`)
                return flow.getNextNodes(node.id, 'ack')[0]?.id ?? null
              } else {
                // No → ask for different title
                const msg = 'Tudo bem! Me fala o que você está procurando 😊'
                await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
                conversation.addAssistantMessage(msg)
                console.log(`[ai_router] yes_no_context: confirm_suggested_title+no → title_search`)
                return flow.getNextNodes(node.id, 'title_search')[0]?.id ?? null
              }
            }

            if (qType === 'want_more_items') {
              if (isNo) {
                const cartCheck = Cart.fromVariables(conversation.variables)
                if (!cartCheck.isEmpty) {
                  console.log(`[ai_router] yes_no_context: want_more_items+no → checkout`)
                  return flow.getNextNodes(node.id, 'checkout')[0]?.id ?? null
                }
              }
            }
          }
        }

        // Multi-title detection: AI extracts titles from any format
        const multipleTitles = await this.aiExtractTitles(userMessage)
        if (multipleTitles.length >= 2 && this.productRepo && this.catalogSearchService) {
          console.log(`[ai_router] multi-title detected (AI): ${multipleTitles.join(' | ')}`)
          const results = await Promise.all(multipleTitles.map(t => this.catalogSearchService!.search(bot.id, t)))
          const found: CartItem[] = []
          const seenProductIds = new Set<string>()
          const notFound: string[] = []
          for (let i = 0; i < results.length; i++) {
            const r = results[i]
            if (r.products.length > 0) {
              const p = r.products[0].product
              if (!seenProductIds.has(p.id)) {
                seenProductIds.add(p.id)
                found.push({ productId: p.id, name: p.name, priceCentavos: p.priceCentavos, accessLink: p.accessLink })
              }
            } else {
              notFound.push(multipleTitles[i])
            }
          }
          if (found.length > 0) {
            const cartObj = Cart.fromVariables(conversation.variables)
            cartObj.addItems(found)
            for (const [k, v] of Object.entries(cartObj.toVariables())) conversation.setVariable(k, v)
            const addedNames = found.map(f => `• ${f.name}`).join('\n')
            const notFoundMsg = notFound.length > 0 ? `\n\nNão encontrei: ${notFound.join(', ')} 😕` : ''
            const msg = `✅ Adicionei ao carrinho:\n${addedNames}${notFoundMsg}\n\nQuer mais alguma? Ou é só falar *pode cobrar* que eu gero o pix!`
            await this.messaging.sendMessage({ instanceName: bot.evolutionConfig.instanceName, instanceId: bot.evolutionConfig.instanceId, phoneNumber: phone, message: msg })
            conversation.addAssistantMessage(msg)
            return flow.getNextNodes(node.id, 'continue')[0]?.id ?? null
          }
        }
        const history = conversation.history.slice(-10)
        const lastBotMessage = [...history].reverse().find(m => m.role === 'assistant')?.content ?? null
        const lastUserMsg = history.filter(m => m.role === 'user').at(-1)
        const minutesSinceLast = lastUserMsg
          ? Math.floor((Date.now() - new Date(lastUserMsg.timestamp).getTime()) / 60_000)
          : 0
        const cart = Cart.fromVariables(conversation.variables)
        // #fix var-morta: __pending_pix_id NUNCA é escrita; a var real é __rt_checkout_payment_id (?? paymentIntentId).
        // Antes hasPendingPayment vinha sempre false → degradava as decisões de pagamento do router.
        const hasPendingPayment = !!(conversation.variables['__rt_checkout_payment_id'] || conversation.variables['paymentIntentId'])

        const decision = await this.contextualAIRouter.route({
          userMessage,
          history,
          phase: conversation.phase,
          lastBotMessage,
          cartItems: cart.items,
          cartTotalBrl: cart.totalInBRL,
          hasPendingPayment,
          minutesSinceLastMessage: minutesSinceLast,
          returningUserThreshold: data.returningUserThresholdMinutes ?? 60,
          botContext: (data.systemPrompt as string | undefined) ?? bot.buildSystemPrompt(),
          persona: buildBotPersona(bot.globalConfig, bot.id),
          savedGenrePref: conversation.variables['__rt_rec_genre'],
          savedTypePref: conversation.variables['__rt_rec_type'],
          lastBotQuestionType: this.detectBotQuestionType(lastBotMessage),
          hasImage: false,
          leadTags: lead?.tags ?? [],
          botId: bot.id,
          conversationId: conversation.id,
          phoneNumber: phone,
        })

        conversation.setVariable('__rt_router_intent', decision.intent)
        conversation.setVariable('__rt_router_next_action', decision.nextAction)

        // ── Catalog searches: suppress reply, let catalog_search respond ──────
        const isCatalogSearch = decision.nextAction === 'search_catalog'
        const isRecommendationSearch = decision.nextAction === 'catalog_recommendation'

        if (!isCatalogSearch && !isRecommendationSearch && decision.reply.trim()) {
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: decision.reply })
          conversation.addAssistantMessage(decision.reply)
        }

        if (decision.shouldResetFlow) {
          conversation.end()
          return undefined
        }

        // ── Title / partial search: save extracted candidate query ─────────────
        if (isCatalogSearch && decision.candidateQuery?.trim()) {
          conversation.setVariable('__rt_router_candidate_query', decision.candidateQuery.trim())
          console.log(`[ai_router] candidateQuery saved: "${decision.candidateQuery}"`)
        }

        // ── Recommendation request: collect prefs + search when ready ──────────
        if (decision.intent === 'recommendation_request') {
          if (decision.genrePreference) conversation.setVariable('__rt_rec_genre', decision.genrePreference)
          if (decision.typePreference)  conversation.setVariable('__rt_rec_type',  decision.typePreference)

          const genre = decision.genrePreference ?? conversation.variables['__rt_rec_genre'] ?? ''
          const type  = decision.typePreference  ?? conversation.variables['__rt_rec_type']  ?? ''
          const shouldSearch = decision.preferencesComplete || (genre && type)

          if (shouldSearch && this.productRepo) {
            console.log(`[ai_router] recommendation search — genre="${genre}" type="${type}"`)
            const products = await this.productRepo.searchByCategory(bot.id, genre, type, 3)

            // #4 Recommendation engine pool log
            flog('recommendation:pool', {
              layer: 'recommendation_engine',
              event: 'pool_searched',
              genre,
              type,
              poolSize: products.length,
              recommendationPool: products.map(p => p.toJSON().name),
              chosenRecommendation: products.length === 1 ? products[0].toJSON().name : products.map(p => p.toJSON().name),
              recommendationReason: `genre=${genre} type=${type}`,
              phone,
            })

            // Clear saved preferences
            delete conversation.variables['__rt_rec_genre']
            delete conversation.variables['__rt_rec_type']

            let recMsg: string
            if (products.length === 0) {
              const label = [type, genre].filter(Boolean).join(' de ')
              recMsg = `Não achei ${label} no catálogo agora 😕\n\nQuer ver o catálogo completo ou prefere outro estilo? 👉 https://dramahub.mfslabs.com.br`
            } else if (products.length === 1) {
              recMsg = `Tenho uma ótima opção pra você: *${products[0].toJSON().name}* 😍\n\nQuer essa?`
            } else {
              const list = products.map((p, i) => `${i + 1}. *${p.toJSON().name}*`).join('\n')
              recMsg = `Encontrei essas opções pra você:\n${list}\n\nQual te interessa? 😊`
            }

            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: recMsg })
            conversation.addAssistantMessage(recMsg)
          } else if (!shouldSearch) {
            // Still collecting preferences — reply was already sent above with the question
            // (reply was not suppressed because nextAction is respond_only for incomplete prefs)
          }

          return flow.getNextNodes(node.id, 'continue')[0]?.id ?? undefined
        }

        const routerHandleMap: Record<string, string> = {
          'respond_only':           'ack',
          'search_catalog':         'title_search',
          'catalog_recommendation': 'title_search', // goes to same catalog_search node
          'show_catalog':           'catalog',
          'checkout':               'checkout',
          'wait_receipt':           'payment_receipt',
          'continue_previous_step': 'continue',
          'human_support':          'handoff',
        }
        // unknown_handoff: ask clarifying question before escalating.
        // Only escalate if __rt_handoff_pending is already set (second trigger).
        if (decision.intent === 'unknown_handoff') {
          const alreadyAsked = conversation.variables['__rt_handoff_pending'] === 'true'
          if (!alreadyAsked) {
            const clarify = 'Me conta o que aconteceu? Vou fazer o possível pra te ajudar 😊'
            await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: clarify })
            conversation.addAssistantMessage(clarify)
            conversation.setVariable('__rt_handoff_pending', 'true')
            await this.convRepo.save(conversation)
            console.log(`[ai_router] unknown_handoff → clarification first for ${phone}`)
            return null
          }
          // Second time: real problem confirmed — clear flag and escalate
          conversation.setVariable('__rt_handoff_pending', '')
        }

        const handle = decision.intent === 'unknown_handoff'
          ? 'handoff'
          : (routerHandleMap[decision.nextAction] ?? 'ack')
        console.log(`[ai_router] intent=${decision.intent} handle=${handle} msg="${userMessage.slice(0, 40)}"`)

        // Inline handoff — don't depend on flow graph having a handoff edge
        if (handle === 'handoff') {
          const reply = decision.reply || 'Entendido! Vou chamar alguém pra te ajudar agora 🙏'
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: reply })
          conversation.addAssistantMessage(reply)
          await this.createHandoff({ bot, conversation, lead, reason: 'user_request', lastMessage: userMessage })
          conversation.handoff()
          await this.convRepo.save(conversation)
          return null
        }

        return flow.getNextNodes(node.id, handle)[0]?.id ?? undefined
      }

      case 'deliver_title': {
        const data = node.data as DeliverTitleNodeData
        const catalogVar      = data.catalogVar          ?? '__rt_catalog_found'
        const remainingVar    = data.remainingSlotsVar   ?? '__rt_remaining_slots'
        const deliveredVar    = data.deliveredSlotsVar   ?? '__rt_delivered_slots'
        const titlesVar       = data.deliveredTitlesVar  ?? '__rt_delivered_titles'
        const pendingVar      = data.pendingTitlesVar    ?? '__rt_delivery_pending'
        const template        = data.messageTemplate     ?? '{{name}}\n\nAcesso: {{accessLink}}'
        const notifyOwner     = data.notifyOwnerOnMissingLink !== false

        const foundRaw = conversation.variables[catalogVar]
        if (!foundRaw) {
          conversation.setVariable('__rt_delivery_error', 'no_products_found')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        let foundItems: CartItem[]
        try { foundItems = JSON.parse(foundRaw) as CartItem[] } catch {
          conversation.setVariable('__rt_delivery_error', 'invalid_catalog_data')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        const remaining = parseInt(conversation.variables[remainingVar] ?? '0', 10)
        if (remaining <= 0) {
          conversation.setVariable('__rt_delivery_error', 'no_remaining_slots')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        const toDeliver = foundItems.slice(0, Math.min(foundItems.length, remaining))
        const delivered: CartItem[] = []
        const pending: CartItem[] = []
        for (const item of toDeliver) {
          if (item.accessLink) delivered.push(item)
          else pending.push(item)
        }

        if (delivered.length === 0 && pending.length === 0) {
          conversation.setVariable('__rt_delivery_error', 'nothing_to_deliver')
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }

        // Send access links
        for (const item of delivered) {
          const msg = template.replace('{{name}}', item.name).replace('{{accessLink}}', item.accessLink ?? '')
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
          this.emit(bot.id, conversation.id, phone, 'delivery_sent', { productId: item.productId, name: item.name })
        }

        // Update slot counters
        const prevDelivered = parseInt(conversation.variables[deliveredVar] ?? '0', 10)
        const newRemaining  = remaining - delivered.length
        conversation.setVariable(deliveredVar, String(prevDelivered + delivered.length))
        conversation.setVariable(remainingVar, String(newRemaining))

        // Accumulate delivered titles
        let prevTitles: string[] = []
        try { prevTitles = JSON.parse(conversation.variables[titlesVar] ?? '[]') } catch {}
        conversation.setVariable(titlesVar, JSON.stringify([...prevTitles, ...delivered.map(i => i.name)]))

        // Accumulate pending + notify owner
        if (pending.length > 0) {
          let prevPending: string[] = []
          try { prevPending = JSON.parse(conversation.variables[pendingVar] ?? '[]') } catch {}
          conversation.setVariable(pendingVar, JSON.stringify([...prevPending, ...pending.map(i => i.name)]))
          if (notifyOwner) {
            const ownerPhone = bot.globalConfig?.ownerPhone
            if (ownerPhone) {
              const names = pending.map(i => i.name).join(', ')
              await this.messaging.sendMessage({
                instanceName: instance, instanceId, phoneNumber: ownerPhone,
                message: `⚠️ Produto sem link para ${phone}: *${names}*\nSlots restantes: ${newRemaining}`,
              })
            }
          }
          return flow.getNextNodes(node.id, 'partial')[0]?.id ?? flow.getNextNodes(node.id, 'error')[0]?.id
        }

        if (newRemaining > 0) return flow.getNextNodes(node.id, 'more')[0]?.id
        return flow.getNextNodes(node.id, 'done')[0]?.id
      }

      case 'handoff_request': {
        const data = node.data as HandoffRequestNodeData
        await this.createHandoff({
          bot, conversation, lead,
          reason: data.reason ?? 'user_request',
          lastMessage: conversation.getLastUserMessage() ?? '',
        })
        if (data.userMessage) {
          await this.messaging.sendMessage({
            instanceName: bot.evolutionConfig.instanceName,
            instanceId: bot.evolutionConfig.instanceId,
            phoneNumber: conversation.phoneNumber,
            message: data.userMessage,
          })
        }
        if (data.notifyOwner !== false) {
          const ownerPhone = bot.globalConfig?.ownerPhone
          if (ownerPhone) {
            await this.messaging.sendMessage({
              instanceName: bot.evolutionConfig.instanceName,
              instanceId: bot.evolutionConfig.instanceId,
              phoneNumber: ownerPhone,
              message: `🤝 *Intervenção solicitada*\nTel: ${conversation.phoneNumber}\nMotivo: ${data.reason}\nÚltima msg: "${conversation.getLastUserMessage() ?? ''}"`,
            }).catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
          }
        }
        conversation.handoff()
        lead?.addTag('needs_human')
        // Handoff é TERMINAL: o flow para aqui e o status 'handoff' fica travado (bot mudo
        // até o humano devolver). Seguir adiante (ex.: nó end ligado na saída) sobrescrevia
        // o status, encerrava a conversa e a PRÓXIMA mensagem do cliente reiniciava o funil
        // por cima do atendimento humano — bug visto em produção (2026-07-15).
        const dangling = flow.getNextNodes(node.id)
        if (dangling.length) {
          console.log(`[FlowExecution] handoff_request é terminal — ignorando saída para ${dangling[0].id}`)
        }
        return undefined
      }

      case 'end':
        return undefined
    }
  }

  async createHandoff(params: {
    bot: Bot
    conversation: Conversation
    lead?: Lead | null
    reason: HandoffReason
    lastMessage: string
  }): Promise<void> {
    if (!this.handoffRepo) return
    const existing = await this.handoffRepo.findByConversationId(params.conversation.id)
    const alreadyOpen = existing.some(h => h.status === 'open' || h.status === 'in_progress')
    if (alreadyOpen) return  // don't duplicate open handoffs

    const handoff = Handoff.create({
      botId: params.bot.id,
      conversationId: params.conversation.id,
      leadId: params.lead?.id ?? null,
      phoneNumber: params.conversation.phoneNumber,
      reason: params.reason,
      lastMessage: params.lastMessage,
      contextSummary: params.lead?.contextSummary ?? null,
      leadTemperature: params.lead?.leadTemperature ?? 'cold',
      leadTags: params.lead?.tags ?? [],
    })
    await this.handoffRepo.save(handoff)
    this.observationRepo?.updateOutcomeByConversation(params.conversation.id, 'escalated', params.reason).catch(e => console.error('[FES] outcome escalated failed:', e?.message))
    this.emit(params.bot.id, params.conversation.id, params.conversation.phoneNumber, 'handoff_requested', {
      reason: params.reason,
      handoffId: handoff.id,
    })

    // #6 Handoff rich diagnostic log
    const last5 = params.conversation.history.slice(-5).map(m => `${m.role}: ${m.content.slice(0, 80)}`)
    const hCart = Cart.fromVariables(params.conversation.variables)
    const hPaymentIntentId =
      params.conversation.variables['__rt_checkout_payment_id'] ??
      params.conversation.variables['paymentIntentId'] ??
      null
    flog('handoff:created', {
      layer: 'handoff',
      reason: params.reason,
      handoffId: handoff.id,
      phone: params.conversation.phoneNumber,
      phase: params.conversation.phase ?? null,
      convPhase: params.conversation.phase ?? null,
      aiIntent: params.conversation.variables['__rt_router_intent'] ?? null,
      paymentIntentId: hPaymentIntentId,
      paymentState: hPaymentIntentId ? 'pending_pix' : 'none',
      cartCount: hCart.count,
      cartItems: hCart.items.map(i => i.name),
      cartTotal: hCart.totalInBRL,
      leadTags: params.lead?.tags ?? [],
      leadTemperature: params.lead?.leadTemperature ?? null,
      last5Messages: last5,
    })
    this.recordOutcome(params.conversation, 'escalated', hCart.totalCentavos || undefined)
    console.log(`[FlowExecution] handoff_created for ${params.conversation.phoneNumber} reason=${params.reason}`)
  }

  /**
   * Rede de segurança (auto-handoff): conta rejeições CONSECUTIVAS de um nó de captura.
   * Ao bater o threshold → escala pro humano (`createHandoff`) + avisa o dono + pausa a conversa (`handoff()`).
   * Sinal COMPORTAMENTAL (cliente preso no capture), NÃO keyword-guessing do input (regra no-regex).
   * Roda independente da fase — cobre `awaiting_payment`, onde o escape hatch é desligado de propósito.
   * Retorna true se escalou (o caller deve parar e NÃO mandar a mensagem de erro de novo).
   * O contador zera quando o capture é aceito (ver bloco capture_accepted).
   */
  private async maybeAutoHandoffOnCaptureReject(params: {
    bot: Bot
    conversation: Conversation
    lead: Lead | null
    reason: 'expected_image_got_text' | 'regex_mismatch'
    lastMessage: string
  }): Promise<boolean> {
    const cfg = params.bot.globalConfig?.autoHandoff
    if ((cfg?.enabled ?? true) === false) return false
    const threshold = cfg?.captureRejects ?? 2

    // Tolerância a RAJADA: várias mensagens em sequência são a MESMA pessoa completando
    // o raciocínio ("Sim" + "as duas turmas"), não teimosia. Rejeição a <30s da anterior
    // não incrementa o contador — só rejeições ESPAÇADAS contam pro escalonamento.
    const key = '__capture_reject_count'
    const atKey = '__capture_reject_at'
    const lastAt = Number(params.conversation.variables[atKey] ?? 0)
    const now = Date.now()
    params.conversation.setVariable(atKey, String(now))
    if (lastAt && now - lastAt < 30_000) return false

    const count = Number(params.conversation.variables[key] ?? 0) + 1
    params.conversation.setVariable(key, String(count))
    if (count < threshold) return false

    // bateu o threshold → escala. Zera o contador p/ não re-disparar handoff em loop.
    params.conversation.setVariable(key, '0')

    // SEM .catch: se o save do handoff falhar, a exceção propaga (a fila re-tenta, idempotente pelo
    // dedup de handoff aberto) e NÃO marcamos handoff() sem registro no DB (evita órfão).
    await this.createHandoff({
      bot: params.bot,
      conversation: params.conversation,
      lead: params.lead,
      reason: 'capture_stuck',
      lastMessage: params.lastMessage,
    })

    // Avisa o dono (createHandoff só salva+emite evento; a notificação é aqui).
    const ownerPhone = params.bot.globalConfig?.ownerPhone
    if (ownerPhone) {
      await this.messaging.sendMessage({
        instanceName: params.bot.evolutionConfig.instanceName,
        instanceId: params.bot.evolutionConfig.instanceId,
        phoneNumber: ownerPhone,
        message:
          `🆘 *Cliente travado* — ${params.conversation.phoneNumber} ` +
          `não conseguiu enviar o esperado (${params.reason}) ${threshold}x seguidas. ` +
          `Conversa pausada e escalada — assuma manualmente.`,
      }).catch(() => {})
    }

    // Pausa o bot (status='handoff' → mensagens seguintes não passam pelo flow; humano assume).
    params.conversation.handoff()

    console.warn(
      `[auto_handoff] capture_stuck conv=${params.conversation.id} phone=${params.conversation.phoneNumber} ` +
      `reason=${params.reason} count=${count}/${threshold}`
    )
    return true
  }

  private extractQuantity(input: string): number | null {
    const trimmed = input.trim()
    // direct integer — cap at 99 to reject obvious garbage ("99999", etc.)
    const direct = parseInt(trimmed, 10)
    if (!isNaN(direct) && direct > 0 && direct <= 99 && /^\d+$/.test(trimmed)) return direct
    // number embedded in sentence: "quero 3", "2 séries"
    const match = trimmed.match(/\b(\d+)\b/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > 0 && n <= 99) return n  // cap: garbage like "!!!@@@ 123456" should not match as quantity
    }
    // portuguese words
    const normalized = trimmed.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
    const words: Record<string, number> = {
      'uma': 1, 'um': 1, 'huma': 1,
      'duas': 2, 'dois': 2,
      'tres': 3, 'três': 3,
      'quatro': 4,
      'cinco': 5,
      'dez': 10,
      'vinte': 20,
      'trinta': 30,
    }
    for (const [word, num] of Object.entries(words)) {
      if (normalized.includes(word)) return num
    }
    return null
  }

  /**
   * Humanização gated por bot (globalConfig.typingSimulation): mostra "digitando…"
   * e espera um tempo proporcional ao tamanho da bolha antes de enviar.
   * ~40 chars/s de "digitação", clamp 2–5s (teto baixo: o lock por telefone é 45s
   * e a maior sequência entre capturas tem 6 bolhas). Presence falhar não bloqueia.
   */
  private async simulateTyping(
    bot: Bot,
    instanceName: string,
    instanceId: string | undefined,
    phoneNumber: string,
    messageLength: number,
  ): Promise<void> {
    if (!bot.globalConfig?.typingSimulation) return
    // jitter ±20%: cadência nunca é idêntica entre leads (sinal anti-spam)
    const base = Math.min(5, Math.max(2, 1 + messageLength / 40))
    const seconds = base * (0.8 + Math.random() * 0.4)
    try {
      await this.messaging.sendPresence?.({ instanceName, instanceId, phoneNumber, state: 'composing' })
    } catch { /* presence é cosmético */ }
    await new Promise(r => setTimeout(r, seconds * 1000))
    try {
      await this.messaging.sendPresence?.({ instanceName, instanceId, phoneNumber, state: 'paused' })
    } catch { /* presence é cosmético */ }
  }

  /**
   * Funil roteirizado convivendo com runtime='agent': diz se a mensagem pertence
   * ao motor de flow — ou porque abre um flow de trigger 'keyword' (conversa nova),
   * ou porque continua uma conversa que já está dentro de um flow de keyword.
   * O messageWorker usa isso pra desviar do AgentRuntime só nesses casos.
   */
  async shouldHandleViaKeywordFlow(bot: Bot, phoneNumber: string, message: string): Promise<boolean> {
    const conversation = await this.convRepo.findActiveByPhone(bot.id, phoneNumber)
    if (conversation && conversation.status !== 'ended') {
      if (!conversation.flowId) return false
      const flow = await this.flowRepo.findById(conversation.flowId)
      const trig = flow?.nodes.find(n => n.type === 'trigger')
      return (trig?.data as TriggerNodeData | undefined)?.triggerType === 'keyword'
    }
    const botFlows = await this.flowRepo.findByBotId(bot.id)
    return botFlows.some(f => {
      if (f.id === bot.activeFlowId) return false
      const trig = f.nodes.find(n => n.type === 'trigger')
      const d = trig?.data as TriggerNodeData | undefined
      return d?.triggerType === 'keyword' && !!d?.keywords?.length && this.matchesTrigger(f, message)
    })
  }

  private matchesTrigger(flow: Flow, message: string): boolean {
    const trigger = flow.getTriggerNode()
    const data = trigger.data as TriggerNodeData
    if (data.triggerType === 'any_message') return true
    if (data.triggerType === 'first_message') return true
    if (data.triggerType === 'keyword' && data.keywords) {
      return data.keywords.some(k => message.toLowerCase().includes(k.toLowerCase()))
    }
    return false
  }

  private evaluateCondition(
    value: string,
    operator: ConditionNodeData['operator'],
    expected: string,
  ): boolean {
    switch (operator) {
      case 'equals': return value.toLowerCase() === expected.toLowerCase()
      case 'contains': return value.toLowerCase().includes(expected.toLowerCase())
      case 'starts_with': return value.toLowerCase().startsWith(expected.toLowerCase())
      case 'regex': return new RegExp(expected, 'i').test(value)
    }
  }

  private interpolate(template: string, variables: Record<string, string>): string {
    if (!template) return ''
    // #fix interpolate-leak: NUNCA ecoar `{{var}}` cru pro cliente quando a variável está ausente
    // (acontece quando o estado foi limpo/resetado). Substitui por '' e loga pra rastrear o template dependente.
    return template.replace(/{{(\w+)}}/g, (_, key) => {
      const v = variables[key]
      if (v === undefined || v === null) {
        console.warn(`[interpolate] var ausente "${key}" — renderizando vazio (template dependia de estado não setado)`)
        return ''
      }
      return v
    })
  }

  // #sec ReDoS: o validationRegex vem do flow (configurável pelo operador). Como o atacante controla o
  // INPUT, uma regex mal-escrita do dono + input criado pode causar backtracking catastrófico. Mitigação:
  // cap no tamanho do input testado (limita o backtracking) + try-catch (regex inválida não trava o fluxo).
  // Fail-open: regex inválida → trata como "casou" (não rejeita entrada legítima por erro de config).
  private safeRegexTest(pattern: string, input: string): boolean {
    try {
      const capped = input.length > 500 ? input.slice(0, 500) : input
      // 'i': validação de resposta nunca é case-sensitive ("Sim" travava no padrão "sim" —
      // 2 rejeições → auto-handoff; travou clientes reais em 2026-07-15)
      return new RegExp(pattern, 'i').test(capped)
    } catch {
      console.warn(`[safeRegexTest] regex inválida no flow: ${pattern.slice(0, 80)}`)
      return true
    }
  }

  private parseAmountToCentavos(raw: string): number | null {
    if (!raw) return null
    const cleaned = raw.trim()
    if (/^\d+$/.test(cleaned)) return parseInt(cleaned, 10)
    return parseCurrencyToCentavos(cleaned)
  }

  // ─── P1: IntentResult ──────────────────────────────────────────────────────

  private normalize(text: string): string {
    return text.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
  }

  private isCatalogPaste(text: string): boolean {
    const lines = text.split('\n').filter(l => l.trim().length > 0)
    if (lines.length < 3) return false
    const n = this.normalize(text)
    const catalogSignals = ['dublado', 'dorama', 'romance •', 'drama •', 'acao •', 'suspense •', 'comedia •', 'fantasia •', 'quero esse dorama', '+ quero', 'genero', 'sinopse']
    const signalCount = catalogSignals.filter(s => n.includes(s)).length
    return signalCount >= 2
  }

  /** Detects structured webapp selection: "Olá! Gostaria dessas minisséries: • Title1 • Title2 Desejo essas minisséries!" */
  private isWebappSelection(text: string): boolean {
    const n = this.normalize(text)
    return (
      (n.includes('gostaria dessas minisseries') || n.includes('desejo essas minisseries')) &&
      text.includes('• ')
    )
  }


  /** Fast rule-based classification used by both quickClassify and classifyIntentRich */
  private runRules(text: string): {
    intent: string
    confidence: number
    quantityDetected: number | null
    titleDetected: string | null
    objectionType: 'price' | 'trust' | 'unsure' | null
    sentiment: 'positive' | 'neutral' | 'negative'
  } | null {
    const n = this.normalize(text)

    const greetingPatterns = ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'tudo bom', 'ei', 'opa', 'hey', 'hello', 'hi', 'bom dia!', 'oi!']
    if (greetingPatterns.some(p => n === p || n === p + '!' || n.startsWith(p + ' ')))
      return { intent: 'greeting', confidence: 0.95, quantityDetected: null, titleDetected: null, objectionType: null, sentiment: 'positive' }

    // Availability check — must run BEFORE quantity so "Cavaleiros do Sol, você tem?" is not misclassified
    const availPatterns = [
      'voce tem', 'voces tem', 'tem essa', 'tem no catalogo', 'tem disponivel', 'voce teria',
      'encontro ai', 'encontro nesse', 'tem ai', 'vi uma serie', 'vi uma minisserie',
      'vi um dorama', 'tem o dorama', 'tem a serie', 'tem a minisserie',
      'tem essa serie', 'procurando por', 'existe essa', 'voce tem essa',
    ]
    const hasAvailSignal = availPatterns.some(p => n.includes(p))
    if (hasAvailSignal) {
      // Extract title: strip availability phrase and return the rest as the title
      const titleRaw = text
        .replace(/\b(voce[s]? te[mr]|tem essa|tem no catalogo|tem disponivel|tem ai|vi uma? (minisserie|serie|dorama)?|procurando por|existe essa|encontro ai?)\b/gi, '')
        .replace(/[?!,]/g, '')
        .trim()
      const titleDetected = titleRaw.length > 2 ? titleRaw : null
      return { intent: 'availability_check', confidence: 0.92, quantityDetected: null, titleDetected, objectionType: null, sentiment: 'positive' }
    }

    const qty = this.extractQuantity(text)
    if (qty !== null)
      return { intent: 'quantity', confidence: 0.93, quantityDetected: qty, titleDetected: null, objectionType: null, sentiment: 'positive' }

    const adPatterns = ['essa mesmo', 'so essa', 'a do anuncio', 'da propaganda', 'essa serie', 'essa ai', 'quero essa', 'vi no anuncio', 'do anuncio']
    if (adPatterns.some(p => n.includes(p)))
      return { intent: 'ad_series', confidence: 0.90, quantityDetected: 1, titleDetected: null, objectionType: null, sentiment: 'positive' }

    const catalogPatterns = ['catalogo', 'escolher antes', 'posso ver', 'ver antes', 'posso escolher', 'quero ver', 'ver opcoes', 'lista de series', 'tem lista', 'lista das series']
    if (catalogPatterns.some(p => n.includes(p)))
      return { intent: 'catalog', confidence: 0.88, quantityDetected: null, titleDetected: null, objectionType: null, sentiment: 'neutral' }

    const paidPatterns = ['ja paguei', 'ja fiz', 'enviei o comprovante', 'fiz o pix', 'ja transferi', 'paguei agora', 'enviei agora', 'mandei o pix', 'comprovante']
    if (paidPatterns.some(p => n.includes(p)))
      return { intent: 'pix_pending', confidence: 0.92, quantityDetected: null, titleDetected: null, objectionType: null, sentiment: 'positive' }

    const pricePatterns = ['desconto', 'mais barato', 'muito caro', 'vi por', 'ta caro', 'preco errado', 'cobrando errado', 'caro demais', 'nao vale']
    if (pricePatterns.some(p => n.includes(p)))
      return { intent: 'price_issue', confidence: 0.87, quantityDetected: null, titleDetected: null, objectionType: 'price', sentiment: 'negative' }

    const doubtPatterns = ['dublada', 'dubla', 'legenda', 'capitulos', 'episodios', 'completa', 'sinopse', 'sobre o que', 'de que trata', 'tem audio', 'em portugues', 'assistir', 'onde assisto', 'quantos ep', 'como funciona']
    if (doubtPatterns.some(p => n.includes(p)))
      return { intent: 'doubt', confidence: 0.82, quantityDetected: null, titleDetected: null, objectionType: null, sentiment: 'neutral' }

    // Title search: message that's clearly a title name (no quantity, no other patterns)
    const titlePatterns = [/^[a-z\s]{4,40}$/, /dorama/, /serie/, /amor/, /familia/, /real/, /drama/]
    const looksLikeTitle = titlePatterns.some(p => typeof p === 'string' ? n.includes(p) : p.test(n))
    if (looksLikeTitle && qty === null)
      return { intent: 'title_search', confidence: 0.72, quantityDetected: null, titleDetected: text.trim(), objectionType: null, sentiment: 'positive' }

    return null
  }

  /** Lightweight sync classify — used by P3 trigger pre-classify.
   *  Prefers flow-configured IntentRules; falls back to hardcoded runRules() for unconfigured flows. */
  quickClassify(text: string, intents?: import('@whatsbot/core').IntentRule[]): { intent: string; confidence: number; quantityDetected: number | null; titleDetected: string | null } {
    if (intents?.length) {
      const r = this.runConfiguredRules(text, intents)
      if (r) return { intent: r.handle, confidence: r.confidence, quantityDetected: r.quantityDetected, titleDetected: r.titleDetected ?? null }
      return { intent: 'unknown', confidence: 0.3, quantityDetected: null, titleDetected: null }
    }
    const result = this.runRules(text)
    if (result) return result
    return { intent: 'unknown', confidence: 0.3, quantityDetected: null, titleDetected: null }
  }

  /** Full async classify with AI fallback — used by classify_intent node (P1) */
  private async classifyIntentRich(text: string, lead?: Lead): Promise<{
    intent: string
    confidence: number
    leadTemperature: string
    quantityDetected: number | null
    titleDetected: string | null
    objectionType: 'price' | 'trust' | 'unsure' | null
    sentiment: 'positive' | 'neutral' | 'negative'
    shouldEscalate: boolean
  }> {
    const rules = this.runRules(text)

    // Compute temperature from lead state
    const temp = this.computeLeadTemperature(lead)

    if (rules) {
      return {
        ...rules,
        leadTemperature: temp,
        shouldEscalate: rules.sentiment === 'negative' && rules.confidence > 0.85,
      }
    }

    // AI fallback via Groq for ambiguous messages
    if (this.aiService) {
      try {
        const context = lead
          ? `Lead: ${lead.totalSessions} sessões, tags: [${lead.tags.join(', ')}], temperatura: ${lead.leadTemperature}.`
          : ''
        const prompt = `${context}\nMensagem do cliente: "${text}"\n\nRetorne JSON com exatamente estas chaves:\n{"intent":"greeting|buy_interest|catalog|quantity|availability_check|title_search|doubt|price_issue|pix_pending|upsell|unknown","confidence":0.0,"quantityDetected":null,"titleDetected":null,"objectionType":null,"sentiment":"positive|neutral|negative","shouldEscalate":false}\n\navailability_check = cliente pergunta se uma série específica está disponível ("você tem X?", "tem essa série?", "vi X, vocês têm?")\ntitleDetected = nome da série mencionada, se houver\n\nRetorne SOMENTE o JSON, sem texto adicional.`
        const r = await this.aiService.generate('groq', { prompt, temperature: 0.1, maxTokens: 120 })
        const raw = r.text.trim().replace(/^```json?|```$/g, '').trim()
        const parsed = JSON.parse(raw)
        return {
          intent: parsed.intent ?? 'unknown',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          leadTemperature: temp,
          quantityDetected: parsed.quantityDetected ?? null,
          titleDetected: parsed.titleDetected ?? null,
          objectionType: parsed.objectionType ?? null,
          sentiment: parsed.sentiment ?? 'neutral',
          shouldEscalate: parsed.shouldEscalate ?? false,
        }
      } catch {
        // AI failed — safe fallback
      }
    }

    return { intent: 'unknown', confidence: 0.3, leadTemperature: temp, quantityDetected: null, titleDetected: null, objectionType: null, sentiment: 'neutral', shouldEscalate: false }
  }

  private storeIntentResult(conversation: Conversation, result: { intent: string; confidence: number; leadTemperature: string; quantityDetected: number | null; titleDetected: string | null; objectionType: string | null; sentiment: string; shouldEscalate: boolean }): void {
    conversation.setVariable('__rt_intent', result.intent)
    conversation.setVariable('__rt_confidence', result.confidence.toFixed(2))
    conversation.setVariable('__rt_lead_temperature', result.leadTemperature)
    conversation.setVariable('__rt_sentiment', result.sentiment)
    conversation.setVariable('__rt_should_escalate', result.shouldEscalate ? 'true' : 'false')
    if (result.quantityDetected !== null) {
      conversation.setVariable('__rt_intent_qty', String(result.quantityDetected))
      conversation.setVariable('__rt_quantity_detected', String(result.quantityDetected))
    }
    if (result.titleDetected) {
      conversation.setVariable('__rt_title_detected', result.titleDetected)
    }
    if (result.objectionType) {
      conversation.setVariable('__rt_objection_type', result.objectionType)
    }
    conversation.setVariable('__rt_intent_result', JSON.stringify(result))
  }

  /**
   * #fix regex-state-blind (raiz do "phantom receipt"): "paguei/comprovante" (paidPatterns) classifica
   * pix_pending com conf 0.92 SEM olhar estado. Um comprador recorrente com carrinho VAZIO e SEM pix pendente
   * era jogado em capture_receipt e depois ACUSADO quando mandava o print (sem paymentIntentId). Aqui, se o
   * handle é de comprovante mas não há pagamento pendente NEM carrinho, redireciona pra 'unknown' (clarify/AI),
   * em vez de exigir comprovante de nada. Sinal de ESTADO, não de palavra-chave.
   */
  private guardReceiptHandle(handle: string, conversation: Conversation): string {
    if (handle !== 'pix_pending' && handle !== 'payment_receipt') return handle
    const hasPending = !!(conversation.variables['__rt_checkout_payment_id'] || conversation.variables['paymentIntentId'])
    if (hasPending) return handle
    if (!Cart.fromVariables(conversation.variables).isEmpty) return handle
    console.warn(`[classify_intent] guard_receipt: "${handle}" sem pix pendente e carrinho vazio → 'unknown' (evita phantom-receipt)`)
    return 'unknown'
  }

  private intentToHandle(intent: string): string {
    const map: Record<string, string> = {
      greeting: 'greeting',
      quantity: 'quantity',
      ad_series: 'ad_series',
      catalog: 'catalog',
      pix_pending: 'pix_pending',
      price_issue: 'price_issue',
      doubt: 'doubt',
      title_search: 'catalog',
      buy_interest: 'quantity',
      upsell: 'quantity',
      availability_check: 'availability_check',
    }
    return map[intent] ?? 'unknown'
  }

  private computeLeadTemperature(lead?: Lead): string {
    if (!lead) return 'cold'
    if (lead.tags.includes('vip') || lead.purchasedTitles.length >= 3) return 'vip'
    if (lead.tags.includes('buyer')) return 'hot'
    if (lead.tags.includes('high_intent') || lead.tags.includes('pix_generated')) return 'hot'
    if (lead.tags.includes('warm_lead') || lead.totalSessions >= 2) return 'warm'
    return lead.leadTemperature
  }

  // ─── P2: context summary ───────────────────────────────────────────────────

  private buildContextSummary(lead: Lead, conversation: Conversation): string {
    const parts: string[] = []
    const intent = conversation.variables['__rt_intent']
    const titles = lead.purchasedTitles
    const sessions = lead.totalSessions

    if (titles.length > 0) {
      parts.push(`Comprou ${titles.length} série(s).`)
    } else if (intent === 'price_issue') {
      parts.push('Questionou o preço.')
    } else if (intent === 'pix_pending') {
      parts.push('Tentou enviar comprovante.')
    } else if (['quantity', 'buy_interest', 'ad_series'].includes(intent ?? '')) {
      const qty = conversation.variables['__rt_intent_qty']
      parts.push(`Demonstrou interesse em comprar${qty ? ` (${qty} série(s))` : ''}.`)
    } else if (intent === 'catalog') {
      parts.push('Pediu para ver o catálogo.')
    }

    if (sessions > 1) parts.push(`${sessions} sessões no total.`)
    if (lead.abandonedPixCount > 0) parts.push(`PIX não finalizado ${lead.abandonedPixCount}x.`)

    return parts.join(' ') || 'Lead visitou o bot.'
  }

  // ─── Configurable intent rules executor ────────────────────────────────────

  private matchPattern(normalized: string, pattern: string): boolean {
    const p = this.normalize(pattern)
    // Word-boundary aware: pattern must appear as a full token (not inside a longer word)
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[\\s,!?¿¡.])${esc}(?=$|[\\s,!?¿¡.])`, 'i').test(normalized)
  }

  private runConfiguredRules(
    text: string,
    rules: import('@whatsbot/core').IntentRule[],
  ): { handle: string; confidence: number; quantityDetected: number | null; titleDetected: string | null } | null {
    const n = this.normalize(text)
    let defaultRule: import('@whatsbot/core').IntentRule | null = null

    for (const rule of rules) {
      if (rule.isDefault) { defaultRule = rule; continue }

      if (rule.extractNumber) {
        const qty = this.extractQuantity(text)
        if (qty !== null)
          return { handle: rule.handle, confidence: 0.93, quantityDetected: qty, titleDetected: null }
      }

      if (rule.keywords?.length) {
        if (rule.keywords.every(k => n.includes(this.normalize(k))))
          return { handle: rule.handle, confidence: 0.90, quantityDetected: null, titleDetected: null }
      }

      if (rule.patterns?.length) {
        if (rule.patterns.some(p => this.matchPattern(n, p)))
          return { handle: rule.handle, confidence: 0.88, quantityDetected: null, titleDetected: null }
      }
    }

    if (defaultRule)
      return { handle: defaultRule.handle, confidence: 0.60, quantityDetected: null, titleDetected: null }

    return null
  }

  // ─── AI title extractor — works for any format ──────────────────────────────

  private async aiExtractTitles(text: string): Promise<string[]> {
    try {
      const result = await this.aiService.generate('groq', {
        systemPrompt: 'You are a title extractor. Extract product/series/item names from the user message. Return a JSON array of strings — one entry per title. If there are fewer than 2 distinct titles, return []. Never include phrases like "Desejo essas" or "Gostaria de" — only the actual titles.',
        promptTemplate: '{{userMessage}}',
        history: [],
        userMessage: text,
        variables: {},
        temperature: 0,
        maxTokens: 200,
        cacheSystemPrompt: true,
      })
      const match = result.content.match(/\[[\s\S]*\]/)
      if (!match) return []
      const parsed = JSON.parse(match[0])
      if (!Array.isArray(parsed)) return []
      return parsed.filter((t: unknown) => typeof t === 'string' && t.trim().length > 2)
    } catch {
      return []
    }
  }

  // ─── AI Agent for classify_intent (unmapped scenarios) ─────────────────────

  // Resolve a política do escape hatch PARA A PARTE onde a conversa está (ver Brain/spec_escape_hatch.md).
  // escapeMode da parte sobrescreve o default do bot; 'inherit'/ausente = usa o toggle do bot.
  private resolveEscapePolicy(flow: Flow, conversation: Conversation, bot: Bot): {
    active: boolean; forceHandoff: boolean; hint?: string; onUnhandled: 'reask' | 'handoff'; maxConsecutive: number
  } {
    const gap = bot.globalConfig?.aiGapFill
    const seg = flow.segments.find(s => s.nodeIds.includes(conversation.currentNodeId))
    const mode = seg?.escapeMode ?? 'inherit'
    let active = false, forceHandoff = false
    if (mode === 'off') active = false
    else if (mode === 'handoff') { active = true; forceHandoff = true }
    else if (mode === 'cover') active = true
    else active = !!gap?.enabled // inherit → default do bot
    return {
      active, forceHandoff, hint: seg?.escapeHint,
      onUnhandled: gap?.onUnhandled ?? 'reask',
      maxConsecutive: gap?.maxConsecutive ?? 3,
    }
  }

  // Roda o escape hatch e executa os efeitos (responde / handoff), devolvendo o resultado pro caller navegar.
  // routes = rotas disponíveis (vazio em capture). Anti-loop via __rt_gapfill_count.
  private async runEscapeHatch(
    flow: Flow, conversation: Conversation, lead: Lead | undefined, bot: Bot, message: string, routes: EscapeRoute[],
  ): Promise<{ outcome: 'inactive' | 'answered' | 'routed' | 'handoff' | 'unknown'; handle?: string }> {
    const policy = this.resolveEscapePolicy(flow, conversation, bot)
    if (!policy.active || !this.aiService) return { outcome: 'inactive' }

    const doHandoff = async () => {
      await this.createHandoff({ bot, conversation, lead, reason: 'unknown_intent', lastMessage: message })
        .catch(e => console.error('[escape_hatch] createHandoff failed:', e?.message))
    }

    const count = Number(conversation.variables['__rt_gapfill_count'] ?? 0)
    if (count >= policy.maxConsecutive) { await doHandoff(); return { outcome: 'handoff' } }
    if (policy.forceHandoff) { await doHandoff(); return { outcome: 'handoff' } }

    const history = conversation.history.slice(-6).map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content}`).join('\n')
    const decision = await new EscapeHatchService(this.aiService).decide({
      message, history, knowledge: bot.globalConfig?.agentKnowledge ?? '', routes, allowAnswer: true, hint: policy.hint,
    })
    console.log(`[escape_hatch] action=${decision.action} handle=${decision.handle ?? ''} node=${conversation.currentNodeId}`)

    if (decision.action === 'answer' && decision.reply) {
      conversation.setVariable('__rt_gapfill_count', String(count + 1))
      await this.messaging.sendMessage({ instanceName: bot.evolutionConfig.instanceName, instanceId: bot.evolutionConfig.instanceId, phoneNumber: conversation.phoneNumber, message: decision.reply })
      conversation.addAssistantMessage(decision.reply)
      return { outcome: 'answered' }
    }
    if (decision.action === 'route' && decision.handle) {
      conversation.setVariable('__rt_gapfill_count', '0')
      return { outcome: 'routed', handle: decision.handle }
    }
    if (decision.action === 'handoff' || policy.onUnhandled === 'handoff') { await doHandoff(); return { outcome: 'handoff' } }
    conversation.setVariable('__rt_gapfill_count', String(count + 1))
    return { outcome: 'unknown' }
  }

  private async runIntentAgent(
    text: string,
    conversation: Conversation,
    lead: Lead | undefined,
    bot: Bot,
    agentConfig: import('@whatsbot/core').IntentAiAgent,
  ): Promise<{ action: 'route' | 'respond' | 'handoff'; handle?: string; message?: string; titleDetected?: string; quantityDetected?: number }> {
    if (!this.aiService) return { action: 'route', handle: 'unknown' }

    const history = conversation.history.slice(-6).map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content}`).join('\n')
    const leadCtx = lead
      ? `Lead: ${lead.totalSessions} sessões, temperatura ${lead.leadTemperature}, tags [${lead.tags.join(', ')}].`
      : ''
    const handlesJson = JSON.stringify(agentConfig.availableHandles ?? [])
    const canInline = agentConfig.canRespondInline !== false

    const prompt = `${agentConfig.systemPrompt}

${leadCtx}
Histórico recente:
${history}

Mensagem do cliente: "${text}"

Handles disponíveis no fluxo:
${handlesJson}

Decida o que fazer. Retorne SOMENTE JSON válido, sem texto adicional:
- Rotear para um handle: {"action":"route","handle":"<handle>","titleDetected":"<título ou null>","quantityDetected":<número ou null>}
${canInline ? '- Responder inline (para dúvidas simples que você pode resolver): {"action":"respond","message":"<sua resposta>"}' : ''}
- Escalar para revisão interna: {"action":"handoff"}

Regra: só use "respond" se a resposta for factual e curta. Para qualquer ação de compra ou troca, use "route".`

    try {
      const provider = agentConfig.provider ?? 'groq'
      const r = await this.aiService.generate(provider, {
        prompt,
        temperature: 0.2,
        maxTokens: 200,
      })
      const raw = r.text.trim().replace(/^```json?|```$/g, '').trim()
      const parsed = JSON.parse(raw)
      return {
        action: parsed.action ?? 'route',
        handle: parsed.handle ?? 'unknown',
        message: parsed.message,
        titleDetected: parsed.titleDetected ?? undefined,
        quantityDetected: typeof parsed.quantityDetected === 'number' ? parsed.quantityDetected : undefined,
      }
    } catch {
      return { action: 'route', handle: 'unknown' }
    }
  }

  // ─── Capture interceptor (smart side-channel for waiting nodes) ─────────────

  private async runCaptureInterceptor(
    interceptor: import('@whatsbot/core').CaptureInterceptor,
    message: string,
    conversation: Conversation,
    lead: Lead | undefined,
    bot: Bot,
  ): Promise<{ action: 'answer' | 'redirect' | 'ignore' | 'handoff'; message?: string; handle?: string }> {
    if (!this.aiService) return { action: 'ignore' }

    const history = conversation.history.slice(-6).map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content}`).join('\n')
    const leadCtx = lead ? `Lead: ${lead.totalSessions} sessões, temperatura ${lead.leadTemperature}.` : ''

    // Inject configured context variables
    const ctxVars = (interceptor.contextVariables ?? [])
      .map(v => `${v}: ${conversation.variables[v] ?? ''}`)
      .filter(v => !v.endsWith(': '))
      .join('\n')

    const redirectsJson = JSON.stringify(interceptor.redirectHandles ?? [])

    const prompt = `${interceptor.systemPrompt}

${leadCtx}
${ctxVars ? `Contexto da conversa:\n${ctxVars}` : ''}

Histórico recente:
${history}

O bot está aguardando uma ação específica do cliente (ex: imagem de comprovante, confirmação, etc.).
O cliente enviou uma mensagem inesperada: "${message}"

Redirects disponíveis:
${redirectsJson}

Decida o que fazer. Retorne SOMENTE JSON válido:
- Responder a dúvida inline e continuar aguardando: {"action":"answer","message":"<resposta curta e amigável>"}
- Redirecionar para um caminho do fluxo: {"action":"redirect","handle":"<handle>"}
- Escalar para um humano: {"action":"handoff"}
- Ignorar e deixar o bot rejeitar normalmente: {"action":"ignore"}

Regra: "answer" só para dúvidas factuais rápidas. "redirect" quando o cliente claramente quer mudar de ação (ex: trocar série, cancelar). "handoff" quando é um PROBLEMA que o bot não resolve — reclamação de pós-venda, "minha série não abre/não recebi/link quebrado/não funciona", pedido de reembolso, ou cliente irritado. "ignore" quando a mensagem é ruído ou incompreensível.`

    try {
      const provider = interceptor.provider ?? 'groq'
      const r = await this.aiService.generate(provider, {
        prompt,
        temperature: 0.2,
        maxTokens: 150,
      })
      const raw = r.text.trim().replace(/^```json?|```$/g, '').trim()
      const parsed = JSON.parse(raw)
      return {
        action: parsed.action ?? 'ignore',
        message: parsed.message,
        handle: parsed.handle,
      }
    } catch {
      return { action: 'ignore' }
    }
  }
}
