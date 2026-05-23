import type { BotRepository, FlowRepository, MessagingPort, Conversation, Flow, Bot, ConversationEventRepository } from '@whatsbot/core'
import type { CaptureNodeData } from '@whatsbot/core'
import type { RedisConversationRepository } from '../adapters/RedisConversationRepository.js'
import type { FlowExecutionService } from './FlowExecutionService.js'

export class TimeoutService {
  constructor(
    private convRepo: RedisConversationRepository,
    private botRepo: BotRepository,
    private flowRepo: FlowRepository,
    private messaging: MessagingPort,
    private flowExec: FlowExecutionService,
    private eventRepo?: ConversationEventRepository,
  ) {}

  start(): void {
    setInterval(() => this.checkTimeouts(), 30_000)
  }

  private async checkTimeouts(): Promise<void> {
    const timedOut = await this.convRepo.findTimedOut()
    for (const conversation of timedOut) {
      try {
        await this.handleTimeout(conversation)
      } catch {
        // skip individually to not block other timeouts
      }
    }
  }

  private async handleTimeout(conversation: Conversation): Promise<void> {
    const bot = await this.botRepo.findById(conversation.botId)
    if (!bot) return

    const flow = await this.flowRepo.findById(conversation.flowId)
    if (!flow) return

    const captureNode = flow.getNodeById(conversation.currentNodeId)
    if (!captureNode || captureNode.type !== 'capture') return

    const data = captureNode.data as CaptureNodeData

    if (data.timeoutMessage) {
      await this.messaging.sendMessage({
        instanceName: bot.evolutionConfig.instanceName,
        phoneNumber: conversation.phoneNumber,
        message: data.timeoutMessage,
      })
    }

    const timeoutNext = flow.getNextNodes(captureNode.id, 'timeout')
    if (timeoutNext.length === 0) {
      const reason = data.suspendedReason ?? `capture:${data.variableName}`
      console.warn(
        `[TimeoutService] WARN: capture node "${captureNode.id}" (${data.variableName}) in flow "${conversation.flowId}" has no timeout edge — suspending as "${reason}". Connect the timeout handle to stop this warning.`,
      )
      conversation.suspend(captureNode.id, {
        snapshotVersion: 1,
        suspendedReason: reason,
        pendingAction: `capture:${captureNode.id}`,
        lastQuestion: data.timeoutMessage,
        recoveryHints: data.recoveryHints ?? [],
      })
      await this.convRepo.save(conversation)
      this.eventRepo?.emit({
        botId: conversation.botId,
        conversationId: conversation.id,
        phoneNumber: conversation.phoneNumber,
        eventType: 'conversation_suspended',
        payload: { reason, nodeId: captureNode.id, variableName: data.variableName },
        occurredAt: new Date(),
      }).catch(() => {})
      return
    }

    conversation.moveToNode(timeoutNext[0].id)
    await this.flowExec.resumeFromNode(bot, flow, conversation)
  }
}
