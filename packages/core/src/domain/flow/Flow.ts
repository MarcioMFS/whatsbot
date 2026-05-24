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
  | 'tag_lead'
  | 'payment_confirmed'
  | 'ai_validate_receipt'  // extract + deterministic validate — outputs: approved | rejected
  | 'catalog_search'       // normalize→alias→fuzzy→AI fallback — outputs: found | not_found
  | 'cart_add'             // batch add from __rt_catalog_found — outputs: success | error
  | 'cart_summary'         // send cart summary message — 1 output
  | 'checkout'             // create PaymentIntent + send Pix message — outputs: success | error
  | 'package_pix'          // quantity-based Pix convenience node — outputs: success | error
  | 'classify_intent'      // rule-based intent router (no AI) — outputs: quantity|ad_series|catalog|pix_pending|price_issue|doubt|unknown
  | 'deliver_title'        // deliver found products and track slots — outputs: done|more|partial|error
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
  amount?: string           // BRL format: "15,00" / "R$ 15,00" / centavos: "1500"
  description?: string
  recipientName?: string    // receiver name shown in message
  expiresInMinutes?: number // PaymentIntent TTL (default 60)
  outputVariable?: string   // conversation variable to save paymentIntentId (default: paymentIntentId)
}

export interface LabelNodeData extends NodeData {
  labelName: string
}

export interface TagLeadNodeData extends NodeData {
  add?: string[]    // tags to add
  remove?: string[] // tags to remove
}

export interface PaymentConfirmedNodeData extends NodeData {
  confirmationMessage?: string  // sent to buyer: "Pagamento confirmado! 🎉"
  postPurchaseMessage?: string  // follow-up: "Em que posso te ajudar agora?"
}

export interface CatalogSearchNodeData extends NodeData {
  searchFrom?: string       // conversation variable to read query from (default: uses current message)
  maxResults?: number       // max products to return (default: 5)
  // handles: 'found' | 'not_found'
  // sets: __rt_catalog_found (JSON), __rt_search_query, __rt_search_unresolved, __rt_has_unresolved
}

export interface CartAddNodeData extends NodeData {
  // reads __rt_catalog_found (JSON array of CartItems)
  // handles: 'success' | 'error' (guardrail: max 20 items / 10 KB)
}

export interface CartSummaryNodeData extends NodeData {
  messageTemplate?: string  // supports {{__rt_cart_summary}}, {{__rt_cart_total}}, {{__rt_cart_count}}
  // 1 output
}

export interface CheckoutNodeData extends NodeData {
  receiverKey?: string       // Pix key (fallback: bot.globalConfig.defaultPixKey)
  receiverName?: string      // Pix receiver name (fallback: bot.globalConfig.defaultReceiverName)
  expiresInMinutes?: number  // PaymentIntent TTL (default: 60)
  pixMessage?: string        // message template to send with Pix key (supports {{amount}}, {{pixKey}})
  outputVariable?: string    // where to save paymentIntentId (default: __rt_checkout_payment_id)
  // handles: 'success' | 'error'
}

export interface AIValidateReceiptNodeData extends NodeData {
  paymentIntentVariable: string  // conversation variable holding the paymentIntentId
  // handles: 'approved' | 'rejected'
}

export interface ClassifyIntentNodeData extends NodeData {
  messageVariable?: string  // var to classify (default: last user message)
  // sets: __rt_intent, __rt_intent_qty, __rt_wants_ad_series
  // handles: greeting | quantity | ad_series | catalog | pix_pending | price_issue | doubt | unknown
}

export interface DeliverTitleNodeData extends NodeData {
  catalogVar?: string             // default: '__rt_catalog_found'
  remainingSlotsVar?: string      // default: '__rt_remaining_slots'
  deliveredSlotsVar?: string      // default: '__rt_delivered_slots'
  deliveredTitlesVar?: string     // default: '__rt_delivered_titles'
  pendingTitlesVar?: string       // default: '__rt_delivery_pending'
  messageTemplate?: string        // default: '{{name}}\n\nAcesso: {{accessLink}}'
  notifyOwnerOnMissingLink?: boolean // default: true
  // handles: done | more | partial | error
}

export interface PackagePixNodeData extends NodeData {
  quantityVariable: string     // variable name that holds the quantity (integer string)
  unitPriceCentavos?: number   // unit price per item (default: 600 = R$6)
  outputVariable?: string      // where to save paymentIntentId (default: paymentIntentId)
  pixKey?: string              // override bot.globalConfig.defaultPixKey
  recipientName?: string       // override bot.globalConfig.defaultReceiverName
  expiresInMinutes?: number    // default: 60
  // handles: 'success' | 'error'
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
  suspendedReason?: string
  recoveryHints?: string[]
  expectedInputType?: 'text' | 'image' | 'document' | 'audio' | 'any'
  timeoutBehavior?: 'suspend' | 'followup' | 'end'
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
