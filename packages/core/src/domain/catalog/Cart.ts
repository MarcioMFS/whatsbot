export interface CartItem {
  productId: string
  name: string
  priceCentavos: number
  accessLink?: string
}

const RT_CART_KEY = '__rt_cart'
const RT_TOTAL_KEY = '__rt_cart_total'
const RT_TOTAL_BRL_KEY = '__rt_cart_total_brl'
const RT_COUNT_KEY = '__rt_cart_count'
const RT_SUMMARY_KEY = '__rt_cart_summary'
const RT_LINKS_KEY = '__rt_cart_access_links'

const MAX_ITEMS = 20
const MAX_BYTES = 10 * 1024 // 10 KB

export class CartGuardrailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CartGuardrailError'
  }
}

export class Cart {
  private _items: CartItem[]

  private constructor(items: CartItem[]) {
    this._items = items
  }

  static empty(): Cart {
    return new Cart([])
  }

  static fromVariables(variables: Record<string, string>): Cart {
    const raw = variables[RT_CART_KEY]
    if (!raw) return Cart.empty()
    try {
      const items = JSON.parse(raw) as CartItem[]
      return new Cart(Array.isArray(items) ? items : [])
    } catch {
      return Cart.empty()
    }
  }

  get items(): CartItem[] { return [...this._items] }
  get count(): number { return this._items.length }
  get totalCentavos(): number { return this._items.reduce((s, i) => s + i.priceCentavos, 0) }

  get totalInBRL(): string {
    return `R$ ${(this.totalCentavos / 100).toFixed(2).replace('.', ',')}`
  }

  get isEmpty(): boolean { return this._items.length === 0 }

  toSummaryLines(): string[] {
    return this._items.map(i => `• ${i.name} — R$ ${(i.priceCentavos / 100).toFixed(2).replace('.', ',')}`)
  }

  get accessLinks(): string {
    return this._items
      .map(i => i.accessLink)
      .filter((l): l is string => Boolean(l))
      .join('\n')
  }

  addItem(item: CartItem): void {
    if (this._items.length >= MAX_ITEMS) {
      throw new CartGuardrailError(`Carrinho cheio (máximo ${MAX_ITEMS} itens). Finalize o pedido antes de adicionar mais.`)
    }
    const newItems = [...this._items, item]
    const serialized = JSON.stringify(newItems)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) {
      throw new CartGuardrailError('Carrinho excedeu o limite de tamanho. Finalize o pedido atual antes de continuar.')
    }
    this._items = newItems
  }

  addItems(items: CartItem[]): void {
    for (const item of items) {
      this.addItem(item)
    }
  }

  clear(): void {
    this._items = []
  }

  toVariables(): Record<string, string> {
    const summary = this.toSummaryLines().join('\n')
    return {
      [RT_CART_KEY]: JSON.stringify(this._items),
      [RT_TOTAL_KEY]: String(this.totalCentavos),
      [RT_TOTAL_BRL_KEY]: this.totalInBRL,
      [RT_COUNT_KEY]: String(this.count),
      [RT_SUMMARY_KEY]: summary,
      [RT_LINKS_KEY]: this.accessLinks,
    }
  }

  static clearKeys(): string[] {
    return [RT_CART_KEY, RT_TOTAL_KEY, RT_TOTAL_BRL_KEY, RT_COUNT_KEY, RT_SUMMARY_KEY, RT_LINKS_KEY]
  }
}
