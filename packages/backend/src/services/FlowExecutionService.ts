import {
  Conversation,
  Flow,
  type FlowRepository,
  type ConversationRepository,
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
  type Bot,
} from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'

export class FlowExecutionService {
  constructor(
    private flowRepo: FlowRepository,
    private convRepo: ConversationRepository,
    private messaging: MessagingPort,
    private aiService: AIGenerationService,
  ) {}

  async handleIncomingMessage(bot: Bot, phoneNumber: string, message: string, imageBase64?: string): Promise<void> {
    if (!bot.isActive || !bot.activeFlowId) return

    const flow = await this.flowRepo.findById(bot.activeFlowId)
    if (!flow) return

    let conversation = await this.convRepo.findActiveByPhone(bot.id, phoneNumber)

    if (!conversation || conversation.status === 'ended') {
      if (!this.matchesTrigger(flow, message)) return
      conversation = Conversation.create({
        botId: bot.id,
        flowId: flow.id,
        phoneNumber,
        triggerNodeId: flow.getTriggerNode().id,
      })
    }

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

    await this.executeFlow(bot, flow, conversation)
  }

  async resumeFromNode(bot: Bot, flow: Flow, conversation: Conversation): Promise<void> {
    return this.executeFlow(bot, flow, conversation)
  }

  private async executeFlow(bot: Bot, flow: Flow, conversation: Conversation): Promise<void> {
    const maxSteps = 20
    let steps = 0

    try {
      while (steps++ < maxSteps) {
        const node = flow.getNodeById(conversation.currentNodeId)
        if (!node || node.type === 'end') {
          conversation.end()
          break
        }

        const nextNodeId = await this.executeNode(bot, flow, conversation, node)

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
