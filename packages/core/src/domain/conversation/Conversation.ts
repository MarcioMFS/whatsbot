import { randomUUID } from 'crypto'

// Mídia anexada a uma mensagem do histórico — o painel de Conversas renderiza
// player/thumbnail a partir daqui. url ausente = mídia inbound (não guardamos base64).
export interface MessageMedia {
  type: 'image' | 'video' | 'audio' | 'document'
  url?: string
  filename?: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  msgId?: string       // WhatsApp message ID (inbound only)
  sender?: string      // phone number of the sender (inbound only)
  direction?: 'inbound' | 'outbound'
  media?: MessageMedia
}

export type ConversationStatus = 'active' | 'waiting' | 'suspended' | 'ended' | 'handoff'

export type ConversationPhase =
  | 'pre_sale'
  | 'browsing_catalog'
  | 'building_cart'
  | 'checkout_started'
  | 'awaiting_payment'
  | 'payment_review'
  | 'payment_confirmed'
  | 'delivery_pending'
  | 'post_purchase'
  | 'post_purchase_support'
  | 'awaiting_human_intermediation'
  | 'closed'

export interface ConversationSnapshot {
  snapshotVersion: 1
  suspendedReason?: string   // e.g. "awaiting_pix_receipt" — for analytics + recovery routing
  lastQuestion?: string
  pendingAction?: string
  recoveryHints?: string[]
}

export interface ConversationProps {
  id: string
  botId: string
  flowId: string
  phoneNumber: string
  currentNodeId: string
  variables: Record<string, string>
  history: Message[]
  status: ConversationStatus
  phase: ConversationPhase
  timeoutAt: Date | null
  snapshot: ConversationSnapshot | null
  startedAt: Date
  updatedAt: Date
}

export class Conversation {
  private props: ConversationProps

  private constructor(props: ConversationProps) {
    this.props = props
  }

  static create(params: {
    botId: string
    flowId: string
    phoneNumber: string
    triggerNodeId: string
  }): Conversation {
    return new Conversation({
      id: randomUUID(),
      botId: params.botId,
      flowId: params.flowId,
      phoneNumber: params.phoneNumber,
      currentNodeId: params.triggerNodeId,
      variables: {},
      history: [],
      status: 'active',
      phase: 'pre_sale',
      timeoutAt: null,
      snapshot: null,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: ConversationProps): Conversation {
    return new Conversation({
      ...props,
      phase: props.phase ?? 'pre_sale', // backward compat with persisted conversations
      timeoutAt: props.timeoutAt ?? null,
      snapshot: props.snapshot ?? null,
    })
  }

  addUserMessage(content: string, meta?: { msgId?: string; sender?: string; media?: MessageMedia }): void {
    this.props.history.push({ role: 'user', content, timestamp: new Date(), direction: 'inbound', ...meta })
    this.props.updatedAt = new Date()
  }

  addAssistantMessage(content: string, media?: MessageMedia): void {
    this.props.history.push({ role: 'assistant', content, timestamp: new Date(), direction: 'outbound', ...(media ? { media } : {}) })
    this.props.updatedAt = new Date()
  }

  moveToNode(nodeId: string): void {
    this.props.currentNodeId = nodeId
    this.props.status = 'active'
    this.props.timeoutAt = null
    this.props.updatedAt = new Date()
  }

  waitForInput(nodeId: string, timeoutAt?: Date): void {
    this.props.currentNodeId = nodeId
    this.props.status = 'waiting'
    this.props.timeoutAt = timeoutAt ?? null
    this.props.updatedAt = new Date()
  }

  setVariable(key: string, value: string): void {
    this.props.variables[key] = value
    this.props.updatedAt = new Date()
  }

  setPhase(phase: ConversationPhase): void {
    this.props.phase = phase
    this.props.updatedAt = new Date()
  }

  suspend(nodeId: string, snapshot?: ConversationSnapshot): void {
    this.props.currentNodeId = nodeId
    this.props.status = 'suspended'
    this.props.timeoutAt = null
    this.props.snapshot = snapshot ?? this.props.snapshot
    this.props.updatedAt = new Date()
  }

  resume(): void {
    this.props.status = 'waiting'
    this.props.snapshot = null
    this.props.updatedAt = new Date()
  }

  handoff(): void {
    this.props.status = 'handoff'
    this.props.timeoutAt = null
    this.props.updatedAt = new Date()
  }

  end(): void {
    this.props.status = 'ended'
    this.props.timeoutAt = null
    this.props.snapshot = null
    this.props.updatedAt = new Date()
  }

  getLastUserMessage(): string | null {
    const msgs = this.props.history.filter(m => m.role === 'user')
    return msgs.length > 0 ? msgs[msgs.length - 1].content : null
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get flowId() { return this.props.flowId }
  get phoneNumber() { return this.props.phoneNumber }
  get currentNodeId() { return this.props.currentNodeId }
  get variables() { return { ...this.props.variables } }
  get history() { return [...this.props.history] }
  get status() { return this.props.status }
  get phase() { return this.props.phase }
  get timeoutAt() { return this.props.timeoutAt }
  get snapshot() { return this.props.snapshot }
  get startedAt() { return this.props.startedAt }
  get updatedAt() { return this.props.updatedAt }

  toJSON(): ConversationProps {
    return { ...this.props }
  }
}
