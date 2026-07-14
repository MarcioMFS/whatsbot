import type { Conversation } from '../domain/conversation/Conversation.js'

export interface ConversationRepository {
  findActiveByPhone(botId: string, phoneNumber: string): Promise<Conversation | null>
  /** Conversas AO VIVO (active/waiting/suspended/handoff) do bot — para o painel de conversas em tempo real. */
  findActiveByBotId?(botId: string): Promise<Conversation[]>
  findById(id: string): Promise<Conversation | null>
  save(conversation: Conversation): Promise<void>
  findByBotId(botId: string, limit?: number): Promise<Conversation[]>
}
