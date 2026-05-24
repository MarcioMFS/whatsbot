import { randomUUID } from 'crypto'

interface ProductProps {
  id: string
  botId: string
  name: string
  description?: string
  priceCentavos: number
  category?: string
  isAvailable: boolean
  accessLink?: string
  aliases: string[]
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

interface CreateProductInput {
  botId: string
  name: string
  description?: string
  priceCentavos: number
  category?: string
  accessLink?: string
  aliases?: string[]
  metadata?: Record<string, unknown>
}

export class Product {
  private constructor(private props: ProductProps) {}

  static create(input: CreateProductInput): Product {
    return new Product({
      id: randomUUID(),
      botId: input.botId,
      name: input.name,
      description: input.description,
      priceCentavos: input.priceCentavos,
      category: input.category,
      isAvailable: true,
      accessLink: input.accessLink,
      aliases: input.aliases ?? [],
      metadata: input.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: ProductProps): Product {
    return new Product(props)
  }

  get id() { return this.props.id }
  get botId() { return this.props.botId }
  get name() { return this.props.name }
  get description() { return this.props.description }
  get priceCentavos() { return this.props.priceCentavos }
  get category() { return this.props.category }
  get isAvailable() { return this.props.isAvailable }
  get accessLink() { return this.props.accessLink }
  get aliases() { return this.props.aliases }
  get metadata() { return this.props.metadata }
  get createdAt() { return this.props.createdAt }
  get updatedAt() { return this.props.updatedAt }

  get priceInBRL(): string {
    return `R$ ${(this.props.priceCentavos / 100).toFixed(2).replace('.', ',')}`
  }

  updateInfo(updates: {
    name?: string
    description?: string
    priceCentavos?: number
    category?: string
    accessLink?: string
    metadata?: Record<string, unknown>
  }): void {
    if (updates.name !== undefined) this.props.name = updates.name
    if (updates.description !== undefined) this.props.description = updates.description
    if (updates.priceCentavos !== undefined) this.props.priceCentavos = updates.priceCentavos
    if (updates.category !== undefined) this.props.category = updates.category
    if (updates.accessLink !== undefined) this.props.accessLink = updates.accessLink
    if (updates.metadata !== undefined) this.props.metadata = updates.metadata
    this.props.updatedAt = new Date()
  }

  setAvailability(available: boolean): void {
    this.props.isAvailable = available
    this.props.updatedAt = new Date()
  }

  setAliases(aliases: string[]): void {
    this.props.aliases = aliases
    this.props.updatedAt = new Date()
  }

  addAlias(alias: string): void {
    if (!this.props.aliases.includes(alias)) {
      this.props.aliases = [...this.props.aliases, alias]
      this.props.updatedAt = new Date()
    }
  }

  removeAlias(alias: string): void {
    this.props.aliases = this.props.aliases.filter(a => a !== alias)
    this.props.updatedAt = new Date()
  }

  toJSON(): ProductProps {
    return { ...this.props, aliases: [...this.props.aliases] }
  }
}
