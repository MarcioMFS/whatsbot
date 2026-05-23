import type { ConversationEvent, ConversationEventType } from '../domain/conversation/ConversationEvent.js'

export interface ConversationEventRepository {
  emit(event: ConversationEvent): Promise<void>
  findByBot(botId: string, limit?: number): Promise<ConversationEvent[]>
  findByPhone(botId: string, phoneNumber: string): Promise<ConversationEvent[]>
  countByType(botId: string, eventType: ConversationEventType, since: Date): Promise<number>
}
