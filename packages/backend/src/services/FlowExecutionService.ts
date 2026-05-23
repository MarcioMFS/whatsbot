import {
  Conversation,
  Lead,
  Flow,
  type FlowRepository,
  type ConversationRepository,
  type LeadRepository,
  type ConversationEventRepository,
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
  type Bot,
  type ConversationSnapshot,
} from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'
import type { PaymentOrchestrator } from '../payment/PaymentOrchestrator.js'

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
  ) {}

  private emit(botId: string, convId: string, phone: string, type: Parameters<ConversationEventRepository['emit']>[0]['eventType'], payload: Record<string, unknown> = {}): void {
    this.eventRepo?.emit({ botId, conversationId: convId, phoneNumber: phone, eventType: type, payload, occurredAt: new Date() }).catch(() => {})
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

  async handleIncomingMessage(bot: Bot, phoneNumber: string, message: string, imageBase64?: string): Promise<void> {
    if (!bot.isActive || !bot.activeFlowId) return

    let conversation = await this.convRepo.findActiveByPhone(bot.id, phoneNumber)
    let lead = await this.leadRepo.findByPhone(bot.id, phoneNumber)

    const hasImage = !!imageBase64

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

    // inject lead context into conversation variables
    conversation.setVariable('__lead_tags', lead.tags.join(','))
    if (lead.name) conversation.setVariable('__lead_name', lead.name)

    conversation.addUserMessage(message)
    if (imageBase64) conversation.setVariable('__imageBase64', imageBase64)

    if (conversation.status === 'waiting') {
      const currentNode = flow.getNodeById(conversation.currentNodeId)
      if (currentNode?.type === 'capture') {
        const data = currentNode.data as CaptureNodeData
        if (data.validationRegex && !new RegExp(data.validationRegex).test(message)) {
          await this.messaging.sendMessage({
            instanceName: bot.evolutionConfig.instanceName,
            phoneNumber,
            message: data.errorMessage ?? 'Invalid input. Please try again.',
          })
          await this.convRepo.save(conversation)
          return
        }
        conversation.setVariable(data.variableName, message)
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
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
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
        const amount = data.amount ? this.interpolate(String(data.amount), conversation.variables) : ''
        const desc = data.description ? this.interpolate(data.description, conversation.variables) : ''
        const lines = [`💳 *Chave Pix para pagamento*`, ``, `\`${data.pixKey}\``]
        if (amount) lines.push(``, `Valor: *R$ ${amount}*`)
        if (desc) lines.push(`Descrição: ${desc}`)
        if (data.recipientName) lines.push(`Favorecido: ${data.recipientName}`)
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
        conversation.setPhase('post_purchase_support')
        console.log(`[FlowExecution] payment_confirmed for ${conversation.phoneNumber}`)
        this.emit(bot.id, conversation.id, conversation.phoneNumber, 'flow_completed', {
          reason: 'payment_confirmed',
          phase: 'post_purchase_support',
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

      case 'end':
        return undefined
    }
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
}
