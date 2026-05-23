import { randomUUID } from 'crypto'

export type PendingIntentStatus = 'pending' | 'fulfilled' | 'expired'

export interface PendingIntentProps {
  id: string
  botId: string
  conversationId: string
  type: string                         // e.g. "awaiting_pix_receipt"
  status: PendingIntentStatus
  createdAt: Date
  expiresAt: Date | null
  fulfilledAt: Date | null
  confidence: number | null
  recoveryHints: string[]
  metadata: Record<string, unknown>    // paymentIntentId, nodeId, etc
}

export class PendingIntent {
  private props: PendingIntentProps

  private constructor(props: PendingIntentProps) {
    this.props = props
  }

  static create(params: {
    botId: string
    conversationId: string
    type: string
    recoveryHints?: string[]
    expiresAt?: Date
    confidence?: number
    metadata?: Record<string, unknown>
  }): PendingIntent {
    return new PendingIntent({
      id: randomUUID(),
      botId: params.botId,
      conversationId: params.conversationId,
      type: params.type,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: params.expiresAt ?? null,
      fulfilledAt: null,
      confidence: params.confidence ?? null,
      recoveryHints: params.recoveryHints ?? [],
      metadata: params.metadata ?? {},
    })
  }

  static reconstitute(props: PendingIntentProps): PendingIntent {
    return new PendingIntent(props)
  }

  fulfill(): void {
    this.props.status = 'fulfilled'
    this.props.fulfilledAt = new Date()
  }

  expire(): void {
    if (this.props.status === 'pending') {
      this.props.status = 'expired'
    }
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get conversationId() { return this.props.conversationId }
  get type() { return this.props.type }
  get status() { return this.props.status }
  get createdAt() { return this.props.createdAt }
  get expiresAt() { return this.props.expiresAt }
  get fulfilledAt() { return this.props.fulfilledAt }
  get recoveryHints() { return [...this.props.recoveryHints] }
  get metadata() { return { ...this.props.metadata } }

  toJSON(): PendingIntentProps {
    return { ...this.props, recoveryHints: [...this.props.recoveryHints], metadata: { ...this.props.metadata } }
  }
}
