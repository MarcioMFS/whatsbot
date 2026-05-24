import type { Cart } from '../domain/catalog/Cart.js'

export interface CartStore {
  load(conversationId: string): Promise<Cart>
  save(conversationId: string, cart: Cart): Promise<void>
  clear(conversationId: string): Promise<void>
}
