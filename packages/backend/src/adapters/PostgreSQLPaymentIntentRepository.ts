import type { Pool } from 'pg'
import { PaymentIntent } from '@whatsbot/core'
import type { PaymentIntentRepository } from '@whatsbot/core'

export class PostgreSQLPaymentIntentRepository implements PaymentIntentRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<PaymentIntent | null> {
    const { rows } = await this.db.query('SELECT * FROM payment_intents WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findPendingByConversation(conversationId: string): Promise<PaymentIntent | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM payment_intents WHERE conversation_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    )
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByLead(leadId: string, limit = 20): Promise<PaymentIntent[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM payment_intents WHERE lead_id = $1 ORDER BY created_at DESC LIMIT $2',
      [leadId, limit],
    )
    return rows.map(r => this.toDomain(r))
  }

  async findByBot(botId: string, limit = 50): Promise<PaymentIntent[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM payment_intents WHERE bot_id = $1 ORDER BY created_at DESC LIMIT $2',
      [botId, limit],
    )
    return rows.map(r => this.toDomain(r))
  }

  async save(intent: PaymentIntent): Promise<void> {
    const d = intent.toJSON()
    await this.db.query(
      `INSERT INTO payment_intents
         (id, bot_id, lead_id, conversation_id, amount, receiver_key, receiver_name,
          status, transaction_id, attempt_count, expires_at, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         transaction_id = EXCLUDED.transaction_id,
         attempt_count = EXCLUDED.attempt_count,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [d.id, d.botId, d.leadId, d.conversationId, d.amount, d.receiverKey, d.receiverName,
       d.status, d.transactionId, d.attemptCount, d.expiresAt, JSON.stringify(d.metadata), d.createdAt],
    )
  }

  private toDomain(row: Record<string, unknown>): PaymentIntent {
    return PaymentIntent.reconstitute({
      id: row.id as string,
      botId: row.bot_id as string,
      leadId: row.lead_id as string,
      conversationId: row.conversation_id as string,
      amount: row.amount as number,
      receiverKey: row.receiver_key as string,
      receiverName: row.receiver_name as string,
      status: row.status as 'pending' | 'paid' | 'expired' | 'cancelled',
      transactionId: row.transaction_id as string | null,
      attemptCount: row.attempt_count as number,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: new Date(row.created_at as string),
    })
  }
}
