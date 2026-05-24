import type { Product } from '../domain/catalog/Product.js'

export interface ProductRepository {
  findById(id: string): Promise<Product | null>
  findByBotId(botId: string, includeUnavailable?: boolean): Promise<Product[]>
  search(botId: string, query: string, limit?: number): Promise<Product[]>
  save(product: Product): Promise<void>
  delete(id: string): Promise<void>
}
