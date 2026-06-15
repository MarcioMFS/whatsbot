import type { Pool } from 'pg'
import { Order } from '@whatsbot/core'
import type { OrderRepository, OrderItem, OrderStatus } from '@whatsbot/core'

export class PostgreSQLOrderRepository implements OrderRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<Order | null> {
    const { rows } = await this.db.query('SELECT * FROM orders WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByConversation(conversationId: string): Promise<Order[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM orders WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId],
    )
    return rows.map(r => this.toDomain(r))
  }

  async findByBotId(botId: string, limit = 50): Promise<Order[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM orders WHERE bot_id = $1 ORDER BY created_at DESC LIMIT $2',
      [botId, limit],
    )
    return rows.map(r => this.toDomain(r))
  }

  async findByLead(botId: string, leadId: string): Promise<Order[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM orders WHERE bot_id = $1 AND lead_id = $2
         AND status IN ('paid','delivery_pending','delivered')
       ORDER BY created_at DESC`,
      [botId, leadId],
    )
    return rows.map(r => this.toDomain(r))
  }

  async save(order: Order): Promise<void> {
    const d = order.toJSON()
    await this.db.query(
      `INSERT INTO orders
         (id, bot_id, lead_id, conversation_id, payment_intent_id, items, total_centavos, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         items = EXCLUDED.items`,
      [
        d.id, d.botId, d.leadId, d.conversationId, d.paymentIntentId,
        JSON.stringify(d.items), d.totalCentavos, d.status, d.createdAt,
      ],
    )
  }

  private toDomain(row: Record<string, unknown>): Order {
    return Order.reconstitute({
      id: row.id as string,
      botId: row.bot_id as string,
      leadId: row.lead_id as string,
      conversationId: row.conversation_id as string,
      paymentIntentId: row.payment_intent_id as string,
      items: (row.items as OrderItem[]) ?? [],
      totalCentavos: row.total_centavos as number,
      status: row.status as OrderStatus,
      createdAt: new Date(row.created_at as string),
    })
  }
}
