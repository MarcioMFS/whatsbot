import type { PaymentIntent } from '../domain/payment/PaymentIntent.js'

export interface PaymentIntentRepository {
  findById(id: string): Promise<PaymentIntent | null>
  findPendingByConversation(conversationId: string): Promise<PaymentIntent | null>
  findByLead(leadId: string, limit?: number): Promise<PaymentIntent[]>
  save(intent: PaymentIntent): Promise<void>
}
