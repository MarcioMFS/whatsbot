import type { Pool } from 'pg'

export interface DeliveryAttemptRecord {
  orderId: string
  botId: string
  conversationId?: string
  phoneNumber: string
  itemName: string
  accessLink?: string
  status: 'sent' | 'failed' | 'pending_link'
  errorMessage?: string
  deliveredAt?: Date
}

export class PostgreSQLDeliveryAuditRepository {
  constructor(private db: Pool) {}

  async save(record: DeliveryAttemptRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO delivery_attempts
         (order_id, bot_id, conversation_id, phone_number, item_name,
          access_link, status, error_message, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        record.orderId,
        record.botId,
        record.conversationId ?? null,
        record.phoneNumber,
        record.itemName,
        record.accessLink ?? null,
        record.status,
        record.errorMessage ?? null,
        record.deliveredAt ?? null,
      ],
    ).catch(err => {
      console.error('[DeliveryAuditRepository] save failed:', err?.message)
    })
  }
}
