import type { BotRepository, FlowRepository, MessagingPort, Conversation, Flow, Bot, ConversationEventRepository, ConversationOutcomeRepository, LeadRepository, RecoveryConfig } from '@whatsbot/core'
import { MODULE_IDS } from '@whatsbot/core'
import type { ModuleRegistry } from './ModuleRegistry.js'

// Mensagens de recuperação padrão (PIX legado) — usadas quando o bot não configurou recovery.messages.
const DEFAULT_RECOVERY_MESSAGES = [
  'Oi 😊 Seu Pix ainda está pendente! Quer que eu gere um novo link?',
  'Olá! Não vimos seu comprovante ainda. Posso gerar um novo Pix pra você? 🎬',
  'Ainda dá tempo de finalizar! Me envia o comprovante ou peço um novo Pix 😊',
]
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
    private leadRepo?: LeadRepository,
    private eventRepo?: ConversationEventRepository,
    private moduleRegistry?: ModuleRegistry,
    private conversationOutcomeRepo?: ConversationOutcomeRepository,
  ) {}

  start(): void {
    setInterval(() => this.checkTimeouts(), 30_000)
    // PIX recovery: check every 15 minutes
    setInterval(() => this.checkAbandonedPix(), 15 * 60_000)
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
      // F0 — desfecho: capture sem saída de timeout = cliente sumiu nesse passo.
      this.conversationOutcomeRepo?.record({
        conversationId: conversation.id,
        botId: conversation.botId,
        flowId: conversation.flowId ?? null,
        lastPhase: conversation.phase ?? null,
        outcome: 'timeout',
      }).catch(e => console.error('[TimeoutService] outcome record failed:', e?.message))
      return
    }

    conversation.moveToNode(timeoutNext[0].id)
    await this.flowExec.resumeFromNode(bot, flow, conversation)
  }

  private async checkAbandonedPix(): Promise<void> {
    if (!this.leadRepo) return
    try {
      const registry = this.moduleRegistry
      if (!registry) return   // Recuperar é módulo; sem o registro injetado, não roda (index sempre injeta).
      const bots = await this.botRepo.findAllActive()
      for (const bot of bots) {
        if (!bot.activeFlowId) continue
        if (!registry.isEnabled(bot, MODULE_IDS.RECOVER)) continue   // módulo Recuperar desligado p/ este bot
        const recovery = registry.configFor(bot, MODULE_IDS.RECOVER) as RecoveryConfig
        const { instanceName, instanceId } = bot.evolutionConfig as { instanceName: string; instanceId?: string }
        await this.checkAbandonedPixForBot(bot.id, instanceName, instanceId, recovery).catch(err =>
          console.error('[TimeoutService] recovery error for bot', bot.id, err)
        )
      }
    } catch (err) {
      console.error('[TimeoutService] checkAbandonedPix iteration error', err)
    }
  }

  async checkAbandonedPixForBot(botId: string, instanceName: string, instanceId?: string, recovery?: RecoveryConfig): Promise<void> {
    if (!this.leadRepo) return
    // Defaults reproduzem o comportamento legado (PIX): 30min ocioso, 2 nudges, mensagens PIX.
    const idleMs = (recovery?.idleMinutes ?? 30) * 60_000
    const maxAttempts = recovery?.maxAttempts ?? 2
    const recoveryMessages = recovery?.messages?.length ? recovery.messages : DEFAULT_RECOVERY_MESSAGES

    const abandoned = await this.leadRepo.findAbandonedPix(botId, idleMs, {
      triggerTags: recovery?.triggerTags,
      excludeTags: recovery?.excludeTags,
    })
    for (const lead of abandoned) {
      try {
        if (lead.abandonedPixCount >= maxAttempts) {
          lead.addTag('lost')
          lead.setLastState('abandoned_max_attempts')
          await this.leadRepo.save(lead)
          continue
        }
        if (!lead.needsRecovery(idleMs)) continue

        const msg = recoveryMessages[lead.abandonedPixCount % recoveryMessages.length]
        await this.messaging.sendMessage({ instanceName, instanceId, phoneNumber: lead.phoneNumber, message: msg })

        lead.incrementAbandonedPix()
        lead.markRecoverySent()
        lead.setLastState('recovery_sent')
        await this.leadRepo.save(lead)

        console.log(`[TimeoutService] recovery_sent to ${lead.phoneNumber} (attempt ${lead.abandonedPixCount})`)
      } catch (err) {
        console.error('[TimeoutService] checkAbandonedPix error for', lead.phoneNumber, err)
      }
    }
  }

}