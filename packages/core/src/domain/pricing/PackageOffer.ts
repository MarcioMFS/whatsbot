import { randomUUID } from 'crypto'

/**
 * PackageOffer — A pricing rule applied to the shopping cart.
 *
 * IMPORTANT: PackageOffer does NOT know about Products.
 * It only alters the final cart price based on quantity.
 * Product remains the source of truth for catalog, delivery, and analytics.
 *
 * Architecture: Products → Cart → PricingService → PackageOffer → Checkout
 */

export type PackageOfferType = 'quantity_bundle' | 'fixed_bundle'

export type PricingMode =
  | 'exact_quantity'   // applies only if cart.count === quantity
  | 'minimum_quantity' // applies if cart.count >= quantity (largest bracket wins)

export interface PackageOfferProps {
  id: string
  botId: string
  name: string
  description?: string
  type: PackageOfferType
  pricingMode: PricingMode
  quantity: number
  priceCentavos: number
  isActive: boolean
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export class PackageOffer {
  private constructor(private props: PackageOfferProps) {}

  static create(params: {
    botId: string
    name: string
    description?: string
    type: PackageOfferType
    pricingMode: PricingMode
    quantity: number
    priceCentavos: number
    metadata?: Record<string, unknown>
  }): PackageOffer {
    if (params.quantity <= 0) throw new Error('PackageOffer.quantity must be > 0')
    if (params.priceCentavos <= 0) throw new Error('PackageOffer.priceCentavos must be > 0')

    return new PackageOffer({
      id: randomUUID(),
      ...params,
      isActive: true,
      metadata: params.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: PackageOfferProps): PackageOffer {
    return new PackageOffer(props)
  }

  update(params: {
    name?: string
    description?: string
    pricingMode?: PricingMode
    quantity?: number
    priceCentavos?: number
    isActive?: boolean
    metadata?: Record<string, unknown>
  }): void {
    if (params.name !== undefined) this.props.name = params.name
    if (params.description !== undefined) this.props.description = params.description
    if (params.pricingMode !== undefined) this.props.pricingMode = params.pricingMode
    if (params.quantity !== undefined) {
      if (params.quantity <= 0) throw new Error('quantity must be > 0')
      this.props.quantity = params.quantity
    }
    if (params.priceCentavos !== undefined) {
      if (params.priceCentavos <= 0) throw new Error('priceCentavos must be > 0')
      this.props.priceCentavos = params.priceCentavos
    }
    if (params.isActive !== undefined) this.props.isActive = params.isActive
    if (params.metadata !== undefined) this.props.metadata = params.metadata
    this.props.updatedAt = new Date()
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get name() { return this.props.name }
  get description() { return this.props.description }
  get type() { return this.props.type }
  get pricingMode() { return this.props.pricingMode }
  get quantity() { return this.props.quantity }
  get priceCentavos() { return this.props.priceCentavos }
  get isActive() { return this.props.isActive }
  get metadata() { return this.props.metadata }
  get createdAt() { return this.props.createdAt }
  get updatedAt() { return this.props.updatedAt }

  toJSON(): PackageOfferProps {
    return { ...this.props }
  }
}
