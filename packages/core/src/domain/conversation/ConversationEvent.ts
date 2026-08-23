export type ConversationEventType =
  | 'flow_started'
  | 'flow_completed'
  | 'conversation_suspended'
  | 'conversation_resumed'
  | 'recovery_triggered'
  | 'tag_added'
  | 'tag_removed'
  | 'handoff_triggered'
  | 'payment_requested'
  | 'receipt_received'
  | 'receipt_validated'
  | 'payment_approved'
  | 'payment_rejected'
  | 'payment_expired'
  | 'post_purchase_support_started'
  | 'catalog_searched'
  | 'product_not_found'
  | 'product_added_to_cart'
  | 'cart_cleared'
  | 'checkout_initiated'
  | 'order_created'
  | 'delivery_sent'
  | 'delivery_pending'
  | 'delivery_failed' // itens que não puderam ser entregues (DeliveryService já emite)
  | 'node_reached'

export interface ConversationEvent {
  botId: string
  // null é legítimo: há eventos sem conversa (ex.: ack inline pós-compra). O tipo dizia
  // string e o emitter já passava null — descartar esses eventos apagava telemetria.
  conversationId: string | null
  phoneNumber: string
  eventType: ConversationEventType
  payload: Record<string, unknown>
  occurredAt: Date
}
