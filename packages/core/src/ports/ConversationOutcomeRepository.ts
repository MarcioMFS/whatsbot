import type { ConversationOutcome, ConversationOutcomeType } from '../domain/conversation/ConversationOutcome.js'

export interface ConversationOutcomeRepository {
  // Idempotente: 1 desfecho por conversa. 'paid' é sticky (não é rebaixado por um desfecho posterior).
  record(outcome: ConversationOutcome): Promise<void>
  // Agregado por bot (base do funnel_metrics do F1).
  getStats(botId: string, since: Date): Promise<Record<ConversationOutcomeType, number>>
}
