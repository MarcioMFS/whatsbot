import { randomUUID } from 'crypto'

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
  'buyer',
  'conversion',
  'lost',
  // new
  'new_lead',
  'asked_catalog',
  'pix_generated',
  'pix_pending',
  'payment_failed',
  'needs_human',
  'series_not_found',
  'vip',
  'upsell_candidate',
  'objection_price',
  'objection_trust',
] as const

export type OntologyTag = typeof LEAD_TAG_ONTOLOGY[number]
export type LeadTemperature = 'cold' | 'warm' | 'hot' | 'vip'

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
  // Memory expansion (P2)
  leadTemperature: LeadTemperature
  purchasedTitles: string[]
  preferredGenres: string[]
  objections: string[]
  abandonedPixCount: number
  lastState: string | null
  contextSummary: string | null
  recoverySentAt: Date | null
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
      leadTemperature: 'cold',
      purchasedTitles: [],
      preferredGenres: [],
      objections: [],
      abandonedPixCount: 0,
      lastState: null,
      contextSummary: null,
      recoverySentAt: null,
    })
  }

  static reconstitute(props: LeadProps): Lead {
    return new Lead({
      ...props,
      lastPaymentConfirmedAt: props.lastPaymentConfirmedAt ?? null,
      leadTemperature: props.leadTemperature ?? 'cold',
      purchasedTitles: props.purchasedTitles ?? [],
      preferredGenres: props.preferredGenres ?? [],
      objections: props.objections ?? [],
      abandonedPixCount: props.abandonedPixCount ?? 0,
      lastState: props.lastState ?? null,
      contextSummary: props.contextSummary ?? null,
      recoverySentAt: props.recoverySentAt ?? null,
    })
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
    this.setTemperature('vip')
    this.props.abandonedPixCount = 0
  }

  isRecentBuyer(withinMs = 86_400_000): boolean {
    if (!this.props.lastPaymentConfirmedAt) return false
    return (Date.now() - this.props.lastPaymentConfirmedAt.getTime()) < withinMs
  }

  touch(): void {
    this.props.lastSeenAt = new Date()
  }

  setTemperature(temp: LeadTemperature): void {
    // temperature only escalates, never downgrades (except to vip)
    const order: LeadTemperature[] = ['cold', 'warm', 'hot', 'vip']
    if (temp === 'vip' || order.indexOf(temp) > order.indexOf(this.props.leadTemperature)) {
      this.props.leadTemperature = temp
    }
  }

  addPurchasedTitle(title: string): void {
    if (title && !this.props.purchasedTitles.includes(title)) {
      this.props.purchasedTitles = [...this.props.purchasedTitles, title]
    }
  }

  addPreferredGenre(genre: string): void {
    const g = genre.trim().toLowerCase()
    if (g && !this.props.preferredGenres.includes(g)) {
      this.props.preferredGenres = [...this.props.preferredGenres, g]
    }
  }

  addObjection(objection: string): void {
    const o = objection.trim().toLowerCase()
    if (o && !this.props.objections.includes(o)) {
      this.props.objections = [...this.props.objections, o]
    }
  }

  incrementAbandonedPix(): void {
    this.props.abandonedPixCount += 1
  }

  setLastState(state: string): void {
    this.props.lastState = state
  }

  setContextSummary(summary: string): void {
    this.props.contextSummary = summary.trim() || null
  }

  markRecoverySent(): void {
    this.props.recoverySentAt = new Date()
    this.props.lastSeenAt = new Date()
  }

  needsRecovery(minGapMs = 30 * 60 * 1000): boolean {
    if (!this.props.recoverySentAt) return true
    return (Date.now() - this.props.recoverySentAt.getTime()) > minGapMs
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
  get leadTemperature() { return this.props.leadTemperature }
  get purchasedTitles() { return [...this.props.purchasedTitles] }
  get preferredGenres() { return [...this.props.preferredGenres] }
  get objections() { return [...this.props.objections] }
  get abandonedPixCount() { return this.props.abandonedPixCount }
  get lastState() { return this.props.lastState }
  get contextSummary() { return this.props.contextSummary }
  get recoverySentAt() { return this.props.recoverySentAt }

  toJSON(): LeadProps {
    return {
      ...this.props,
      tags: [...this.props.tags],
      variables: { ...this.props.variables },
      purchasedTitles: [...this.props.purchasedTitles],
      preferredGenres: [...this.props.preferredGenres],
      objections: [...this.props.objections],
    }
  }
}
