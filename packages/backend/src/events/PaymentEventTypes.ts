import type { ReceiptExtractionResult } from '@whatsbot/core'
import type { PaymentValidationDecision } from '@whatsbot/core'

// All domain events — immutable records of what happened

export interface PaymentRequestedEvent {
  type: 'payment_requested'
  botId: string
  conversationId: string
  phoneNumber: string
  paymentIntentId: string
  amountCentavos: number
  receiverKey: string
  occurredAt: Date
}

export interface ReceiptReceivedEvent {
  type: 'receipt_received'
  botId: string
  conversationId: string
  phoneNumber: string
  paymentIntentId: string
  attemptCount: number
  occurredAt: Date
}

export interface ReceiptValidatedEvent {
  type: 'receipt_validated'
  botId: string
  conversationId: string
  phoneNumber: string
  paymentIntentId: string
  decision: PaymentValidationDecision
  occurredAt: Date
}

export interface PaymentApprovedEvent {
  type: 'payment_approved'
  botId: string
  conversationId: string
  phoneNumber: string
  paymentIntentId: string
  transactionId: string
  amountCentavos: number
  occurredAt: Date
}

export interface PaymentRejectedEvent {
  type: 'payment_rejected'
  botId: string
  conversationId: string
  phoneNumber: string
  paymentIntentId: string
  reason: string
  attemptCount: number
  occurredAt: Date
}

export interface PaymentExpiredEvent {
  type: 'payment_expired'
  botId: string
  conversationId: string
  phoneNumber: string
  paymentIntentId: string
  occurredAt: Date
}

export type PaymentDomainEvent =
  | PaymentRequestedEvent
  | ReceiptReceivedEvent
  | ReceiptValidatedEvent
  | PaymentApprovedEvent
  | PaymentRejectedEvent
  | PaymentExpiredEvent
