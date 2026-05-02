import type { BotRepository, FlowRepository, MessagingPort, Conversation, Flow, Bot } from '@whatsbot/core'
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
      conversation.end()
      await this.convRepo.save(conversation)
      return
    }

    conversation.moveToNode(timeoutNext[0].id)
    await this.flowExec.resumeFromNode(bot, flow, conversation)
  }
}
