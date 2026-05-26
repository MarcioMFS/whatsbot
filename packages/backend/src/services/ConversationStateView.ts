import type { Conversation } from '@whatsbot/core'

export interface ConversationStateView {
  phase: string
  status: string
  lockedState: 'handoff' | 'awaiting_payment' | 'free'
  currentGoal: string | null         // __rt_router_intent or __rt_intent
  pendingPayment: boolean
  pendingPixId: string | null
  lastTitles: string[]               // __rt_delivered_titles or __rt_search_resolved
  aiRouterLastIntent: string | null  // __rt_router_intent
  aiRouterLastAction: string | null  // __rt_router_next_action
  cartCount: number
  cartItems: string[]
  receiptFailCount: number
  leadTemperature: string | null
  leadTags: string[]
  currentNodeId: string | null
  historyLength: number
}

export function buildConversationStateView(conversation: Conversation): ConversationStateView {
  const v = conversation.variables

  const lockedState: ConversationStateView['lockedState'] =
    conversation.status === 'handoff' ? 'handoff'
    : conversation.phase === 'awaiting_payment' ? 'awaiting_payment'
    : 'free'

  const cartRaw = v['__rt_cart'] ? (() => {
    try { return JSON.parse(v['__rt_cart']) as Array<{ name: string }> } catch { return [] }
  })() : []

  const lastTitlesRaw = v['__rt_delivered_titles'] ?? v['__rt_search_resolved'] ?? ''
  const lastTitles = lastTitlesRaw
    ? lastTitlesRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []

  const tagsRaw = v['__lead_tags'] ?? ''
  const leadTags = tagsRaw ? tagsRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []

  return {
    phase: conversation.phase,
    status: conversation.status,
    lockedState,
    currentGoal: v['__rt_router_intent'] ?? v['__rt_intent'] ?? null,
    pendingPayment: conversation.phase === 'awaiting_payment',
    pendingPixId: v['__rt_checkout_payment_id'] ?? v['paymentIntentId'] ?? null,
    lastTitles,
    aiRouterLastIntent: v['__rt_router_intent'] ?? null,
    aiRouterLastAction: v['__rt_router_next_action'] ?? null,
    cartCount: cartRaw.length,
    cartItems: cartRaw.map((i: { name: string }) => i.name),
    receiptFailCount: parseInt(v['__rt_receipt_fail_count'] ?? '0', 10),
    leadTemperature: v['__lead_temperature'] ?? null,
    leadTags,
    currentNodeId: conversation.currentNodeId ?? null,
    historyLength: conversation.history.length,
  }
}
