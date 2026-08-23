import { randomUUID } from 'crypto'

export type HandoffStatus = 'open' | 'in_progress' | 'resolved' | 'ignored'

export type HandoffReason =
  | 'unknown_intent'
  | 'price_issue'
  | 'doubt'
  | 'pix_failed'
  | 'series_not_found'
  | 'user_request'
  | 'capture_stuck'
  | 'escalated'
  | 'fraud_accusation' // cliente acusa golpe/fraude — vai pra humano, nunca encerra sozinho
  | 'custom'

export interface HandoffProps {
  id: string
  botId: string
  conversationId: string
  leadId: string | null
  phoneNumber: string
  reason: HandoffReason
  lastMessage: string
  contextSummary: string | null
  leadTemperature: string
  leadTags: string[]
  status: HandoffStatus
  resolvedAt: Date | null
  resolvedBy: string | null
  createdAt: Date
  updatedAt: Date
}

export class Handoff {
  private props: HandoffProps

  private constructor(props: HandoffProps) {
    this.props = props
  }

  static create(params: {
    botId: string
    conversationId: string
    leadId?: string | null
    phoneNumber: string
    reason: HandoffReason
    lastMessage: string
    contextSummary?: string | null
    leadTemperature?: string
    leadTags?: string[]
  }): Handoff {
    return new Handoff({
      id: randomUUID(),
      botId: params.botId,
      conversationId: params.conversationId,
      leadId: params.leadId ?? null,
      phoneNumber: params.phoneNumber,
      reason: params.reason,
      lastMessage: params.lastMessage,
      contextSummary: params.contextSummary ?? null,
      leadTemperature: params.leadTemperature ?? 'cold',
      leadTags: params.leadTags ?? [],
      status: 'open',
      resolvedAt: null,
      resolvedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: HandoffProps): Handoff {
    return new Handoff(props)
  }

  resolve(resolvedBy?: string): void {
    this.props.status = 'resolved'
    this.props.resolvedAt = new Date()
    this.props.resolvedBy = resolvedBy ?? null
    this.props.updatedAt = new Date()
  }

  markInProgress(): void {
    this.props.status = 'in_progress'
    this.props.updatedAt = new Date()
  }

  ignore(): void {
    this.props.status = 'ignored'
    this.props.updatedAt = new Date()
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get conversationId() { return this.props.conversationId }
  get leadId() { return this.props.leadId }
  get phoneNumber() { return this.props.phoneNumber }
  get reason() { return this.props.reason }
  get lastMessage() { return this.props.lastMessage }
  get contextSummary() { return this.props.contextSummary }
  get leadTemperature() { return this.props.leadTemperature }
  get leadTags() { return [...this.props.leadTags] }
  get status() { return this.props.status }
  get resolvedAt() { return this.props.resolvedAt }
  get resolvedBy() { return this.props.resolvedBy }
  get createdAt() { return this.props.createdAt }
  get updatedAt() { return this.props.updatedAt }

  toJSON(): HandoffProps {
    return { ...this.props, leadTags: [...this.props.leadTags] }
  }
}
