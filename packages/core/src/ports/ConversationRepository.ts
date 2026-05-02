import type { Conversation } from '../domain/conversation/Conversation.js'

export interface ConversationRepository {
  findActiveByPhone(botId: string, phoneNumber: string): Promise<Conversation | null>
  findById(id: string): Promise<Conversation | null>
  save(conversation: Conversation): Promise<void>
  findByBotId(botId: string, limit?: number): Promise<Conversation[]>
}
