import { randomUUID } from 'crypto'

// Controlled ontology — AI and flow nodes may only use these tags (prevents semantic entropy)
export const LEAD_TAG_ONTOLOGY = [
  'warm_lead',
  'cold_lead',
  'sent_pix',
  'hesitated',
  'price_sensitive',
  'high_intent',
  'returning_user',
  'asked_price',
  'ignored_offer',
  'requested_support',
  'buyer',        // confirmed payment — drives post-purchase routing
  'conversion',
  'lost',
] as const

export type OntologyTag = typeof LEAD_TAG_ONTOLOGY[number]

export interface LeadProps {
  id: string
  botId: string
  phoneNumber: string
  name: string | null
  tags: string[]
  variables: Record<string, string>
  totalSessions: number
  lastSeenAt: Date
  lastPaymentConfirmedAt: Date | null
  createdAt: Date
}

export class Lead {
  private props: LeadProps

  private constructor(props: LeadProps) {
    this.props = props
  }

  static create(params: { botId: string; phoneNumber: string }): Lead {
    return new Lead({
      id: randomUUID(),
      botId: params.botId,
      phoneNumber: params.phoneNumber,
      name: null,
      tags: [],
      variables: {},
      totalSessions: 1,
      lastSeenAt: new Date(),
      lastPaymentConfirmedAt: null,
      createdAt: new Date(),
    })
  }

  static reconstitute(props: LeadProps): Lead {
    return new Lead({ ...props, lastPaymentConfirmedAt: props.lastPaymentConfirmedAt ?? null })
  }

  addTag(tag: string): void {
    const normalized = tag.trim().toLowerCase()
    if (normalized && !this.props.tags.includes(normalized)) {
      this.props.tags = [...this.props.tags, normalized]
    }
  }

  removeTag(tag: string): void {
    const normalized = tag.trim().toLowerCase()
    this.props.tags = this.props.tags.filter(t => t !== normalized)
  }

  setVariable(key: string, value: string): void {
    this.props.variables[key] = value
  }

  mergeVariables(vars: Record<string, string>): void {
    // only persist non-system variables (no __ prefix)
    for (const [k, v] of Object.entries(vars)) {
      if (!k.startsWith('__')) this.props.variables[k] = v
    }
  }

  setName(name: string): void {
    if (name.trim()) this.props.name = name.trim()
  }

  recordSession(): void {
    this.props.totalSessions += 1
    this.props.lastSeenAt = new Date()
  }

  recordPaymentConfirmed(): void {
    this.props.lastPaymentConfirmedAt = new Date()
    this.props.lastSeenAt = new Date()
    this.addTag('buyer')
    this.addTag('sent_pix')
  }

  isRecentBuyer(withinMs = 86_400_000): boolean {
    if (!this.props.lastPaymentConfirmedAt) return false
    return (Date.now() - this.props.lastPaymentConfirmedAt.getTime()) < withinMs
  }

  touch(): void {
    this.props.lastSeenAt = new Date()
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get phoneNumber() { return this.props.phoneNumber }
  get name() { return this.props.name }
  get tags() { return [...this.props.tags] }
  get variables() { return { ...this.props.variables } }
  get totalSessions() { return this.props.totalSessions }
  get lastSeenAt() { return this.props.lastSeenAt }
  get lastPaymentConfirmedAt() { return this.props.lastPaymentConfirmedAt }
  get createdAt() { return this.props.createdAt }

  toJSON(): LeadProps {
    return { ...this.props, tags: [...this.props.tags], variables: { ...this.props.variables } }
  }
}
