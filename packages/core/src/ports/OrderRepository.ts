import type { Order } from '../domain/catalog/Order.js'

export interface OrderRepository {
  findById(id: string): Promise<Order | null>
  findByConversation(conversationId: string): Promise<Order[]>
  findByBotId(botId: string, limit?: number): Promise<Order[]>
  save(order: Order): Promise<void>
}
