import { randomUUID } from 'crypto'

export interface OrderItem {
  productId: string
  name: string
  priceCentavos: number
  accessLink?: string
}

export type OrderStatus = 'pending' | 'paid' | 'delivery_pending' | 'delivered' | 'cancelled'

interface OrderProps {
  id: string
  botId: string
  leadId: string
  conversationId: string
  paymentIntentId: string
  items: OrderItem[]
  totalCentavos: number
  status: OrderStatus
  createdAt: Date
}

interface CreateOrderInput {
  botId: string
  leadId: string
  conversationId: string
  paymentIntentId: string
  items: OrderItem[]
}

export class Order {
  private constructor(private props: OrderProps) {}

  static create(input: CreateOrderInput): Order {
    const total = input.items.reduce((s, i) => s + i.priceCentavos, 0)
    return new Order({
      id: randomUUID(),
      botId: input.botId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      paymentIntentId: input.paymentIntentId,
      items: input.items.map(i => ({ ...i })),
      totalCentavos: total,
      status: 'pending',
      createdAt: new Date(),
    })
  }

  static reconstitute(props: OrderProps): Order {
    return new Order(props)
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get leadId() { return this.props.leadId }
  get conversationId() { return this.props.conversationId }
  get paymentIntentId() { return this.props.paymentIntentId }
  get items(): OrderItem[] { return this.props.items.map(i => ({ ...i })) }
  get totalCentavos() { return this.props.totalCentavos }
  get status() { return this.props.status }
  get createdAt() { return this.props.createdAt }

  get itemsWithLinks(): OrderItem[] { return this.props.items.filter(i => i.accessLink) }
  get itemsWithoutLinks(): OrderItem[] { return this.props.items.filter(i => !i.accessLink) }
  get hasAllLinks(): boolean { return this.props.items.every(i => Boolean(i.accessLink)) }

  markPaid(): void {
    this.props.status = 'paid'
  }

  markDelivered(): void {
    this.props.status = 'delivered'
  }

  markDeliveryPending(): void {
    this.props.status = 'delivery_pending'
  }

  cancel(): void {
    this.props.status = 'cancelled'
  }

  toJSON(): OrderProps {
    return { ...this.props, items: this.items }
  }
}
