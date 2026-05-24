import type { Handoff, HandoffStatus } from '../domain/handoff/Handoff.js'

export interface HandoffRepository {
  findById(id: string): Promise<Handoff | null>
  findByBotId(botId: string, status?: HandoffStatus, limit?: number, offset?: number): Promise<Handoff[]>
  countByBotId(botId: string, status?: HandoffStatus): Promise<number>
  findByConversationId(conversationId: string): Promise<Handoff[]>
  save(handoff: Handoff): Promise<void>
}
