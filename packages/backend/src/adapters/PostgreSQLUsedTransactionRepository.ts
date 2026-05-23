import type { Pool } from 'pg'
import type { UsedTransactionRepository } from '@whatsbot/core'

export class PostgreSQLUsedTransactionRepository implements UsedTransactionRepository {
  constructor(private db: Pool) {}

  async isUsed(botId: string, transactionId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'SELECT 1 FROM used_transactions WHERE bot_id = $1 AND transaction_id = $2 LIMIT 1',
      [botId, transactionId],
    )
    return rows.length > 0
  }

  async markUsed(botId: string, transactionId: string, paymentIntentId: string, receiptFingerprint: string): Promise<void> {
    await this.db.query(
      `INSERT INTO used_transactions (bot_id, transaction_id, payment_intent_id, receipt_fingerprint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [botId, transactionId, paymentIntentId, receiptFingerprint],
    )
  }

  async isFingerprintUsed(botId: string, fingerprint: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'SELECT 1 FROM used_transactions WHERE bot_id = $1 AND receipt_fingerprint = $2 LIMIT 1',
      [botId, fingerprint],
    )
    return rows.length > 0
  }
}
