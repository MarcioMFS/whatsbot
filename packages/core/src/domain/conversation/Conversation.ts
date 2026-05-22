import { randomUUID } from 'crypto'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export type ConversationStatus = 'active' | 'waiting' | 'ended'

export interface ConversationProps {
  id: string
  botId: string
  flowId: string
  phoneNumber: string
  currentNodeId: string
  variables: Record<string, string>
  history: Message[]
  status: ConversationStatus
  timeoutAt: Date | null
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
      timeoutAt: null,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: ConversationProps): Conversation {
    return new Conversation({ ...props, timeoutAt: props.timeoutAt ?? null })
  }

  addUserMessage(content: string): void {
    this.props.history.push({ role: 'user', content, timestamp: new Date() })
    this.props.updatedAt = new Date()
  }

  addAssistantMessage(content: string): void {
    this.props.history.push({ role: 'assistant', content, timestamp: new Date() })
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

  end(): void {
    this.props.status = 'ended'
    this.props.timeoutAt = null
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
  get timeoutAt() { return this.props.timeoutAt }
  get startedAt() { return this.props.startedAt }
  get updatedAt() { return this.props.updatedAt }

  toJSON(): ConversationProps {
    return { ...this.props }
  }
}
