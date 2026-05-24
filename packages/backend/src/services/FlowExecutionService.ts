import {
  Conversation,
  Lead,
  Flow,
  PaymentIntent,
  Order,
  Cart,
  PricingService,
  parseCurrencyToCentavos,
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
import type { PaymentOrchestrator } from '../payment/PaymentOrchestrator.js'
import type { CatalogSearchService } from './CatalogSearchService.js'
import type { DeliveryService } from './DeliveryService.js'

const RECOVERY_THRESHOLD = 0.6

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
  ) {}

  private emit(botId: string, convId: string, phone: string, type: Parameters<ConversationEventRepository['emit']>[0]['eventType'], payload: Record<string, unknown> = {}): void {
    this.eventRepo?.emit({ botId, conversationId: convId, phoneNumber: phone, eventType: type, payload, occurredAt: new Date() }).catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
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

  private isAcknowledgment(message: string): boolean {
    const acks = ['ok', 'okay', 'obrigado', 'obg', 'valeu', 'vlw', 'tks', 'thanks', 'ótimo', 'otimo', '👍', '🙏']
    const lower = message.toLowerCase().trim()
    return acks.some(a => lower === a || lower.startsWith(a + ' ') || lower.endsWith(' ' + a))
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
    inbound?: { msgId?: string; hasImage?: boolean },
  ): Promise<void> {
    if (!bot.isActive || !bot.activeFlowId) return

    const msgId = inbound?.msgId
    const hasImage = inbound?.hasImage ?? !!imageBase64

    let conversation = await this.convRepo.findActiveByPhone(bot.id, phoneNumber)
    let lead = await this.leadRepo.findByPhone(bot.id, phoneNumber)

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
        this.emit(bot.id, conversation?.id ?? 'none', phoneNumber, 'post_purchase_support_started', {
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
        this.emit(bot.id, conversation?.id ?? 'none', phoneNumber, 'post_purchase_support_started', {
          trigger: message,
          supportFlowId: resolvedFlowId,
          lastPaymentConfirmedAt: lead.lastPaymentConfirmedAt?.toISOString(),
        })
      }
    }

    // resolve flow: routing rules take priority for new conversations
    const flowId = isNewConversation
      ? (bot.resolveFlowId(lead?.tags ?? []) ?? bot.activeFlowId)
      : conversation!.flowId

    const flow = await this.flowRepo.findById(flowId!)
    if (!flow) return

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

    // inject lead context into conversation variables (P2 — memory layer)
    conversation.setVariable('__lead_tags', lead.tags.join(','))
    conversation.setVariable('__lead_temperature', lead.leadTemperature)
    conversation.setVariable('__lead_sessions', String(lead.totalSessions))
    conversation.setVariable('__lead_is_returning', lead.totalSessions > 1 ? 'true' : 'false')
    conversation.setVariable('__lead_purchased_count', String(lead.purchasedTitles.length))
    if (lead.name) conversation.setVariable('__lead_name', lead.name)
    if (lead.contextSummary) conversation.setVariable('__lead_context', lead.contextSummary)

    conversation.addUserMessage(message, { msgId, sender: phoneNumber })
    if (imageBase64) conversation.setVariable('__imageBase64', imageBase64)

    if (conversation.status === 'waiting') {
      const currentNode = flow.getNodeById(conversation.currentNodeId)
      if (currentNode?.type === 'capture') {
        const data = currentNode.data as CaptureNodeData
        const instance = bot.evolutionConfig.instanceName
        const instanceId = bot.evolutionConfig.instanceId

        // ── expectedInputType enforcement ──────────────────────────────────
        // capture_receipt (and any image-only node) must reject text/audio
        if (data.expectedInputType === 'image' && !hasImage) {
          console.warn(
            `[FlowExecution] capture_rejected: node=${currentNode.id} conv=${conversation.id} ` +
            `phone=${phoneNumber} msgId=${msgId ?? 'n/a'} reason=expected_image_got_text ` +
            `msg="${message.slice(0, 80)}"`
          )
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
        if (data.validationRegex && !new RegExp(data.validationRegex).test(message)) {
          console.warn(
            `[FlowExecution] capture_rejected: node=${currentNode.id} conv=${conversation.id} ` +
            `phone=${phoneNumber} msgId=${msgId ?? 'n/a'} reason=regex_mismatch`
          )
          await this.messaging.sendMessage({
            instanceName: instance,
            instanceId,
            phoneNumber,
            message: data.errorMessage ?? 'Entrada inválida. Tente novamente.',
          })
          await this.convRepo.save(conversation)
          return
        }

        // ── accept: store value + audit metadata ───────────────────────────
        const capturedValue = hasImage ? (imageBase64 ? '[image]' : message) : message
        conversation.setVariable(data.variableName, capturedValue)
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

  async resumeFromNode(bot: Bot, flow: Flow, conversation: Conversation): Promise<void> {
    const lead = await this.leadRepo.findByPhone(bot.id, conversation.phoneNumber)
    await this.executeFlow(bot, flow, conversation, lead ?? undefined)
    if (lead) {
      lead.mergeVariables(conversation.variables)
      await this.leadRepo.save(lead)
    }
  }

  private async executeFlow(bot: Bot, flow: Flow, conversation: Conversation, lead?: Lead): Promise<void> {
    const maxSteps = 20
    let steps = 0
    const isStart = conversation.currentNodeId === flow.getTriggerNode().id

    if (isStart) {
      this.emit(bot.id, conversation.id, conversation.phoneNumber, 'flow_started', { flowId: flow.id })
    }

    try {
      while (steps++ < maxSteps) {
        const node = flow.getNodeById(conversation.currentNodeId)
        if (!node || node.type === 'end') {
          conversation.end()
          this.emit(bot.id, conversation.id, conversation.phoneNumber, 'flow_completed', { flowId: flow.id, steps })
          // P2 — persist last state + generate context summary
          if (lead) {
            lead.setLastState(conversation.currentNodeId)
            lead.setContextSummary(this.buildContextSummary(lead, conversation))
          }
          break
        }

        const nextNodeId = await this.executeNode(bot, flow, conversation, node, lead)

        if (nextNodeId === null) break // waiting for user input
        if (!nextNodeId) {
          conversation.end()
          break
        }

        conversation.moveToNode(nextNodeId)
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
        // P3 — intent-first onboarding: if first message already has clear intent, skip intro
        const firstMsg = conversation.getLastUserMessage()
        if (firstMsg) {
          const preClass = this.quickClassify(firstMsg)
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
        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'ai_response': {
        const data = node.data as AIResponseNodeData
        const systemPrompt = bot.buildSystemPrompt()
        const imageBase64 = conversation.variables['__imageBase64']
        if (imageBase64) conversation.setVariable('__imageBase64', '') // consume — não reutilizar
        const provider = imageBase64 ? 'claude' : bot.aiConfig.provider
        try {
          const result = await this.aiService.generate(provider, {
            systemPrompt,
            promptTemplate: data.promptTemplate,
            history: data.useHistory ? conversation.history.slice(-10) : [],
            userMessage: conversation.getLastUserMessage() ?? '',
            variables: conversation.variables,
            temperature: bot.aiConfig.temperature,
            maxTokens: bot.aiConfig.maxTokens,
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
          const msg = variations[Math.floor(Math.random() * variations.length)]
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: msg })
        }
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'notification': {
        const data = node.data as NotificationNodeData
        const msg = this.interpolate(data.message, conversation.variables)
        const target = this.interpolate(data.phoneNumber, conversation.variables)
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

        const lines = [`💳 *Chave Pix para pagamento*`, ``, `\`${receiverKey}\``]
        if (displayAmount) lines.push(``, `Valor: *R$ ${displayAmount}*`)
        if (desc) lines.push(`Descrição: ${desc}`)
        if (receiverName) lines.push(`Favorecido: ${receiverName}`)
        lines.push(``, `_Copie a chave acima e pague pelo seu banco._`)
        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: lines.join('\n') })
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'label': {
        const data = node.data as LabelNodeData
        if (data.labelName) {
          const evolutionUrl = process.env.EVOLUTION_URL ?? 'http://localhost:8082'
          try {
            await fetch(`${evolutionUrl}/chat/updateContact/${instance}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', apikey: instance },
              body: JSON.stringify({ number: phone, label: data.labelName }),
            })
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
        const paymentIntentId = conversation.variables[data.paymentIntentVariable]

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
        })

        conversation.setVariable('__validation_reason', result.decision.reason)
        conversation.setVariable('__validation_approved', result.decision.approved ? 'true' : 'false')

        await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: result.userMessage })

        if (!result.decision.approved) {
          const failCount = parseInt(conversation.variables['__rt_receipt_fail_count'] ?? '0', 10)
          const newCount = failCount + 1
          conversation.setVariable('__rt_receipt_fail_count', String(newCount))
          if (newCount >= 2) {
            this.createHandoff({ bot, conversation, lead, reason: 'pix_failed', lastMessage: conversation.getLastUserMessage() ?? '' }).catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
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
        conversation.setPhase('post_purchase')
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
            const { delivered, pending } = await this.deliveryService.deliver(order, phone, instance, instanceId)
            if (pending.length > 0) {
              order.markDeliveryPending()
              const ownerPhone = bot.globalConfig?.ownerPhone
              if (ownerPhone) {
                const pendingNames = pending.map(i => i.name).join(', ')
                await this.messaging.sendMessage({
                  instanceName: instance, instanceId, phoneNumber: ownerPhone,
                  message: `⚠️ Pedido ${order.id.slice(0, 8)} tem itens sem link de entrega: ${pendingNames}`,
                })
              }
            } else if (delivered.length > 0) {
              order.markDelivered()
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
        const query = data.searchFrom
          ? (conversation.variables[data.searchFrom] ?? conversation.getLastUserMessage() ?? '')
          : (conversation.getLastUserMessage() ?? '')

        conversation.setVariable('__rt_search_query', query)
        conversation.setPhase('browsing_catalog')

        if (!this.catalogSearchService) {
          console.warn('[FlowExecution] catalog_search: no CatalogSearchService — routing not_found')
          return flow.getNextNodes(node.id, 'not_found')[0]?.id
        }

        const result = await this.catalogSearchService.search(bot.id, query)
        this.emit(bot.id, conversation.id, phone, 'catalog_searched', {
          query, found: result.products.length, unresolved: result.unresolved.length,
        })

        if (result.products.length === 0) {
          conversation.setVariable('__rt_has_unresolved', 'true')
          conversation.setVariable('__rt_search_unresolved', JSON.stringify(result.unresolved))
          this.emit(bot.id, conversation.id, phone, 'product_not_found', { query, unresolved: result.unresolved })
          // auto-handoff: série não encontrada
          this.createHandoff({ bot, conversation, lead, reason: 'series_not_found', lastMessage: query }).catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
          return flow.getNextNodes(node.id, 'not_found')[0]?.id
        }

        const foundItems: CartItem[] = result.products.map(r => ({
          productId: r.product.id,
          name: r.product.name,
          priceCentavos: r.product.priceCentavos,
          accessLink: r.product.accessLink,
        }))
        conversation.setVariable('__rt_catalog_found', JSON.stringify(foundItems))
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
        conversation.setPhase('building_cart')
        return flow.getNextNodes(node.id, 'success')[0]?.id ?? flow.getNextNodes(node.id)[0]?.id
      }

      case 'cart_summary': {
        const data = node.data as CartSummaryNodeData
        const cart = Cart.fromVariables(conversation.variables)

        // Run PricingService — PackageOffer is a pricing layer, NOT a product
        const offers = this.packageOfferRepo ? await this.packageOfferRepo.findByBotId(bot.id) : []
        const pricing = PricingService.calculate(cart, offers)
        const pricingVars = PricingService.toPricingVars(pricing)

        // Persist pricing vars so checkout and downstream nodes can read them
        for (const [k, v] of Object.entries(pricingVars)) conversation.setVariable(k, v)

        const hasDiscount = pricing.discountCentavos > 0
        const defaultTemplate = hasDiscount
          ? `🛒 *Seu pedido:*\n\n${cart.toSummaryLines().join('\n')}\n\n📦 ${pricing.itemCount} série(s)\n💰 Valor original: ${PricingService.formatBRL(pricing.originalTotalCentavos)}\n🎁 Pacote: ${pricing.appliedOfferName}\n✂️ Desconto: ${PricingService.formatBRL(pricing.discountCentavos)}\n\n✅ *Total final: ${PricingService.formatBRL(pricing.finalTotalCentavos)}*`
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

          const expiresAt = new Date(Date.now() + (data.expiresInMinutes ?? 60) * 60 * 1000)
          const intent = PaymentIntent.create({
            botId: bot.id,
            leadId: lead?.id ?? conversation.phoneNumber,
            conversationId: conversation.id,
            amount: pricing.finalTotalCentavos, // final price after package offer
            receiverKey,
            receiverName,
            expiresAt,
          })
          await this.paymentIntentRepo.save(intent)

          const outputVar = data.outputVariable ?? '__rt_checkout_payment_id'
          conversation.setVariable(outputVar, intent.id)
          conversation.setVariable('__rt_checkout_payment_id', intent.id)

          const finalAmountBrl = PricingService.formatBRL(pricing.finalTotalCentavos)
          const hasDiscount = pricing.discountCentavos > 0
          const discountLine = hasDiscount
            ? `\n_Pacote aplicado: ${pricing.appliedOfferName} — desconto de ${PricingService.formatBRL(pricing.discountCentavos)}_`
            : ''
          const pixTemplate = data.pixMessage
            ?? `💳 *Pagamento via Pix*\n\nChave: \`${receiverKey}\`\nValor: *${finalAmountBrl}*\nFavorecido: ${receiverName}${discountLine}\n\n_Copie a chave acima e realize o pagamento no seu banco._`
          const pixMsg = this.interpolate(pixTemplate, {
            ...conversation.variables,
            ...pricingVars,
            amount: finalAmountBrl,
            pixKey: receiverKey,
            pixName: receiverName,
          })
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: pixMsg })

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
          conversation.setPhase('awaiting_payment')
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

          const expiresAt = new Date(Date.now() + (data.expiresInMinutes ?? 60) * 60 * 1000)
          const intent = PaymentIntent.create({
            botId: bot.id,
            leadId: lead?.id ?? conversation.phoneNumber,
            conversationId: conversation.id,
            amount: pricing.finalTotalCentavos,
            receiverKey,
            receiverName,
            expiresAt,
          })
          await this.paymentIntentRepo.save(intent)

          const outputVar = data.outputVariable ?? 'paymentIntentId'
          conversation.setVariable(outputVar, intent.id)

          const finalBrl = PricingService.formatBRL(pricing.finalTotalCentavos)
          const hasDiscount = pricing.discountCentavos > 0
          const offerLine = hasDiscount
            ? `\n_${pricing.appliedOfferName}: ${PricingService.formatBRL(pricing.originalTotalCentavos)} → *${finalBrl}*_`
            : ''
          const pixMsg = `💳 *Pagamento via Pix*\n\nChave: \`${receiverKey}\`\nValor: *${finalBrl}*\nFavorecido: ${receiverName}${offerLine}\n\n_Copie a chave e pague no seu banco. Depois me envie o comprovante 🚀_`
          await this.messaging.sendMessage({ instanceName: instance, instanceId, phoneNumber: phone, message: pixMsg })

          this.emit(bot.id, conversation.id, phone, 'payment_requested', {
            paymentIntentId: intent.id, amount: pricing.finalTotalCentavos, receiverKey,
          })
          conversation.setPhase('awaiting_payment')
          return flow.getNextNodes(node.id, 'success')[0]?.id
        } catch (err) {
          console.error('[FlowExecution] package_pix error:', err)
          conversation.setVariable('__rt_package_pix_error', String(err))
          return flow.getNextNodes(node.id, 'error')[0]?.id
        }
      }

      case 'classify_intent': {
        const data = node.data as ClassifyIntentNodeData

        // If trigger already pre-classified this message, reuse it (P3 fast path)
        if (conversation.variables['__rt_pre_classified'] === 'true') {
          conversation.setVariable('__rt_pre_classified', 'false')
          const intent = conversation.variables['__rt_intent'] ?? 'unknown'
          const handle = this.intentToHandle(intent)
          return flow.getNextNodes(node.id, handle)[0]?.id ?? flow.getNextNodes(node.id, 'unknown')[0]?.id
        }

        const text = data.messageVariable
          ? (conversation.variables[data.messageVariable] ?? '')
          : (conversation.getLastUserMessage() ?? '')

        const result = await this.classifyIntentRich(text, lead)
        this.storeIntentResult(conversation, result)

        // Escalation override — routes to unknown so owner gets notified
        if (result.shouldEscalate) {
          return flow.getNextNodes(node.id, 'unknown')[0]?.id
        }

        const handle = this.intentToHandle(result.intent)

        // auto-handoff for unknown/price_issue intents
        if (handle === 'unknown' || result.intent === 'price_issue') {
          const autoReason: HandoffReason = result.intent === 'price_issue' ? 'price_issue' : 'unknown_intent'
          this.createHandoff({ bot, conversation, lead, reason: autoReason, lastMessage: text }).catch(e => console.error('[FlowExecution] createHandoff failed:', e?.message))
        }

        return flow.getNextNodes(node.id, handle)[0]?.id ?? flow.getNextNodes(node.id, 'unknown')[0]?.id
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
        return flow.getNextNodes(node.id, 'output')[0]?.id ?? flow.getNextNodes(node.id)[0]?.id
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
    this.emit(params.bot.id, params.conversation.id, params.conversation.phoneNumber, 'handoff_requested', {
      reason: params.reason,
      handoffId: handoff.id,
    })
    console.log(`[FlowExecution] handoff_created for ${params.conversation.phoneNumber} reason=${params.reason}`)
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
    return template.replace(/{{(\w+)}}/g, (_, key) => variables[key] ?? `{{${key}}}`)
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

  /** Lightweight sync classify — used by P3 trigger pre-classify */
  quickClassify(text: string): { intent: string; confidence: number; quantityDetected: number | null; titleDetected: string | null } {
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
        const prompt = `${context}\nMensagem do cliente: "${text}"\n\nRetorne JSON com exatamente estas chaves:\n{"intent":"greeting|buy_interest|catalog|quantity|title_search|doubt|price_issue|pix_pending|upsell|unknown","confidence":0.0,"quantityDetected":null,"titleDetected":null,"objectionType":null,"sentiment":"positive|neutral|negative","shouldEscalate":false}\n\nRetorne SOMENTE o JSON, sem texto adicional.`
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
}
