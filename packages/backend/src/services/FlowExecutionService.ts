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

  async handleIncomingMessage(bot: Bot, phoneNumber: string, message: string): Promise<void> {
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

    switch (node.type) {
      case 'trigger': {
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'text_message': {
        const data = node.data as TextNodeData
        const msg = this.interpolate(data.message, conversation.variables)
        await this.messaging.sendMessage({ instanceName: instance, phoneNumber: phone, message: msg })
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'ai_response': {
        const data = node.data as AIResponseNodeData
        const systemPrompt = bot.buildSystemPrompt()
        const result = await this.aiService.generate(bot.aiConfig.provider, {
          systemPrompt,
          promptTemplate: data.promptTemplate,
          history: data.useHistory ? conversation.history.slice(-10) : [],
          userMessage: conversation.getLastUserMessage() ?? '',
          variables: conversation.variables,
          temperature: bot.aiConfig.temperature,
          maxTokens: bot.aiConfig.maxTokens,
          cacheSystemPrompt: true,
        })
        conversation.addAssistantMessage(result.content)
        await this.messaging.sendMessage({ instanceName: instance, phoneNumber: phone, message: result.content })
        const nexts = flow.getNextNodes(node.id)
        return nexts[0]?.id
      }

      case 'capture': {
        const data = node.data as CaptureNodeData
        if (data.label) {
          await this.messaging.sendMessage({ instanceName: instance, phoneNumber: phone, message: data.label })
        }
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
