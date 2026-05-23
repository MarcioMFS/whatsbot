import { randomUUID } from 'crypto'

export type PaymentIntentStatus = 'pending' | 'paid' | 'expired' | 'cancelled'

export interface PaymentIntentProps {
  id: string
  botId: string
  leadId: string
  conversationId: string
  amount: number              // integer centavos — R$15,00 = 1500
  receiverKey: string         // Pix key (cpf/cnpj/phone/email/random)
  receiverName: string
  createdAt: Date
  expiresAt: Date | null
  status: PaymentIntentStatus
  transactionId: string | null
  attemptCount: number
  metadata: Record<string, unknown>
}

export class PaymentIntent {
  private props: PaymentIntentProps

  private constructor(props: PaymentIntentProps) {
    this.props = props
  }

  static create(params: {
    botId: string
    leadId: string
    conversationId: string
    amount: number
    receiverKey: string
    receiverName: string
    expiresAt?: Date
    metadata?: Record<string, unknown>
  }): PaymentIntent {
    if (params.amount <= 0 || !Number.isInteger(params.amount)) {
      throw new Error(`PaymentIntent amount must be a positive integer (centavos). Got: ${params.amount}`)
    }
    return new PaymentIntent({
      id: randomUUID(),
      botId: params.botId,
      leadId: params.leadId,
      conversationId: params.conversationId,
      amount: params.amount,
      receiverKey: params.receiverKey,
      receiverName: params.receiverName,
      createdAt: new Date(),
      expiresAt: params.expiresAt ?? null,
      status: 'pending',
      transactionId: null,
      attemptCount: 0,
      metadata: params.metadata ?? {},
    })
  }

  static reconstitute(props: PaymentIntentProps): PaymentIntent {
    return new PaymentIntent(props)
  }

  markPaid(transactionId: string): void {
    if (this.props.status !== 'pending') {
      throw new Error(`Cannot mark as paid — intent is already ${this.props.status}`)
    }
    this.props.status = 'paid'
    this.props.transactionId = transactionId
  }

  expire(): void {
    if (this.props.status === 'pending') {
      this.props.status = 'expired'
    }
  }

  cancel(): void {
    if (this.props.status === 'pending') {
      this.props.status = 'cancelled'
    }
  }

  incrementAttempt(): void {
    this.props.attemptCount += 1
  }

  isExpired(): boolean {
    if (this.props.status !== 'pending') return false
    if (!this.props.expiresAt) return false
    return new Date() > this.props.expiresAt
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get leadId() { return this.props.leadId }
  get conversationId() { return this.props.conversationId }
  get amount() { return this.props.amount }
  get receiverKey() { return this.props.receiverKey }
  get receiverName() { return this.props.receiverName }
  get createdAt() { return this.props.createdAt }
  get expiresAt() { return this.props.expiresAt }
  get status() { return this.props.status }
  get transactionId() { return this.props.transactionId }
  get attemptCount() { return this.props.attemptCount }
  get metadata() { return { ...this.props.metadata } }

  toJSON(): PaymentIntentProps {
    return { ...this.props, metadata: { ...this.props.metadata } }
  }
}
