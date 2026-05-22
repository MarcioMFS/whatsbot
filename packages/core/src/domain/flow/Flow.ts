import { randomUUID } from 'crypto'

export type NodeType =
  | 'trigger'
  | 'ai_response'
  | 'text_message'
  | 'condition'
  | 'capture'
  | 'webhook'
  | 'delay'
  | 'distributor'
  | 'notification'
  | 'pixel'
  | 'pix'
  | 'label'
  | 'end'

export interface NodeData {
  label: string
  [key: string]: unknown
}

export interface TriggerNodeData extends NodeData {
  triggerType: 'any_message' | 'keyword' | 'first_message'
  keywords?: string[]
}

export interface AIResponseNodeData extends NodeData {
  promptTemplate: string
  useHistory: boolean
  saveResponseAs?: string
  model?: string
}

export interface DistributorNodeData extends NodeData {
  variations: string[]
}

export interface NotificationNodeData extends NodeData {
  phoneNumber: string
  message: string
}

export interface PixelNodeData extends NodeData {
  pixelId: string
  accessToken: string
  eventName: string
  value?: string
  currency?: string
}

export interface PixNodeData extends NodeData {
  pixKey: string
  amount?: string
  description?: string
  recipientName?: string
}

export interface LabelNodeData extends NodeData {
  labelName: string
}

export interface TextNodeData extends NodeData {
  message: string
  variables?: string[]
}

export interface ConditionNodeData extends NodeData {
  variable: string
  operator: 'equals' | 'contains' | 'starts_with' | 'regex'
  value: string
}

export interface CaptureNodeData extends NodeData {
  variableName: string
  validationRegex?: string
  errorMessage?: string
  timeoutMinutes?: number
  timeoutMessage?: string
}

export interface WebhookNodeData extends NodeData {
  url: string
  method: 'GET' | 'POST' | 'PUT'
  headers?: Record<string, string>
  bodyTemplate?: string
  saveResponseAs?: string
}

export interface DelayNodeData extends NodeData {
  seconds: number
}

export interface FlowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: NodeData
}

export interface FlowEdge {
  id: string
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
  label?: string
}

export interface FlowProps {
  id: string
  botId: string
  name: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export class Flow {
  private props: FlowProps

  private constructor(props: FlowProps) {
    this.props = props
  }

  static create(params: { botId: string; name: string }): Flow {
    if (!params.name.trim()) throw new Error('Flow name is required')

    const triggerId = randomUUID()

    return new Flow({
      id: randomUUID(),
      botId: params.botId,
      name: params.name,
      nodes: [
        {
          id: triggerId,
          type: 'trigger',
          position: { x: 250, y: 50 },
          data: { label: 'Start', triggerType: 'any_message' } as TriggerNodeData,
        },
      ],
      edges: [],
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: FlowProps): Flow {
    return new Flow(props)
  }

  validate(): void {
    const triggers = this.props.nodes.filter(n => n.type === 'trigger')
    if (triggers.length === 0) throw new Error('Flow must have at least one trigger node')
    if (triggers.length > 1) throw new Error('Flow can only have one trigger node')

  }

  updateNodes(nodes: FlowNode[], edges: FlowEdge[]): void {
    this.props.nodes = nodes
    this.props.edges = edges
    this.props.updatedAt = new Date()
  }

  getNodeById(id: string): FlowNode | undefined {
    return this.props.nodes.find(n => n.id === id)
  }

  getNextNodes(nodeId: string, handle?: string): FlowNode[] {
    const edges = this.props.edges.filter(
      e => e.source === nodeId && (handle ? e.sourceHandle === handle : true)
    )
    return edges
      .map(e => this.getNodeById(e.target))
      .filter((n): n is FlowNode => n !== undefined)
  }

  getTriggerNode(): FlowNode {
    const trigger = this.props.nodes.find(n => n.type === 'trigger')
    if (!trigger) throw new Error('No trigger node found')
    return trigger
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get name() { return this.props.name }
  get nodes() { return this.props.nodes }
  get edges() { return this.props.edges }
  get isDefault() { return this.props.isDefault }
  get createdAt() { return this.props.createdAt }
  get updatedAt() { return this.props.updatedAt }

  toJSON(): FlowProps {
    return { ...this.props }
  }
}
