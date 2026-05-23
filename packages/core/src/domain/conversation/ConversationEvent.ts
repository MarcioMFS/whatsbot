export type ConversationEventType =
  | 'flow_started'
  | 'flow_completed'
  | 'conversation_suspended'
  | 'conversation_resumed'
  | 'recovery_triggered'
  | 'tag_added'
  | 'tag_removed'
  | 'handoff_triggered'

export interface ConversationEvent {
  botId: string
  conversationId: string
  phoneNumber: string
  eventType: ConversationEventType
  payload: Record<string, unknown>
  occurredAt: Date
}
