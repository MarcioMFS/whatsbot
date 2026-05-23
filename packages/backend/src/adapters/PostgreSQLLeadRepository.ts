import type { Pool } from 'pg'
import { Lead } from '@whatsbot/core'
import type { LeadRepository } from '@whatsbot/core'

export class PostgreSQLLeadRepository implements LeadRepository {
  constructor(private db: Pool) {}

  async findByPhone(botId: string, phoneNumber: string): Promise<Lead | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM leads WHERE bot_id = $1 AND phone_number = $2',
      [botId, phoneNumber]
    )
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByBotId(botId: string, limit = 50, offset = 0): Promise<Lead[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM leads WHERE bot_id = $1 ORDER BY last_seen_at DESC LIMIT $2 OFFSET $3',
      [botId, limit, offset]
    )
    return rows.map(r => this.toDomain(r))
  }

  async findByTag(botId: string, tag: string): Promise<Lead[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM leads WHERE bot_id = $1 AND $2 = ANY(tags) ORDER BY last_seen_at DESC',
      [botId, tag.toLowerCase()]
    )
    return rows.map(r => this.toDomain(r))
  }

  async countByBotId(botId: string): Promise<number> {
    const { rows } = await this.db.query(
      'SELECT COUNT(*) FROM leads WHERE bot_id = $1',
      [botId]
    )
    return parseInt(rows[0].count, 10)
  }

  async save(lead: Lead): Promise<void> {
    const d = lead.toJSON()
    await this.db.query(
      `INSERT INTO leads (id, bot_id, phone_number, name, tags, variables, total_sessions, last_seen_at, last_payment_confirmed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (bot_id, phone_number) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, leads.name),
         tags = EXCLUDED.tags,
         variables = EXCLUDED.variables,
         total_sessions = EXCLUDED.total_sessions,
         last_seen_at = EXCLUDED.last_seen_at,
         last_payment_confirmed_at = COALESCE(EXCLUDED.last_payment_confirmed_at, leads.last_payment_confirmed_at)`,
      [d.id, d.botId, d.phoneNumber, d.name, d.tags, JSON.stringify(d.variables),
       d.totalSessions, d.lastSeenAt, d.lastPaymentConfirmedAt, d.createdAt]
    )
  }

  private toDomain(row: Record<string, unknown>): Lead {
    return Lead.reconstitute({
      id: row.id as string,
      botId: row.bot_id as string,
      phoneNumber: row.phone_number as string,
      name: row.name as string | null,
      tags: row.tags as string[],
      variables: row.variables as Record<string, string>,
      totalSessions: row.total_sessions as number,
      lastSeenAt: new Date(row.last_seen_at as string),
      lastPaymentConfirmedAt: row.last_payment_confirmed_at ? new Date(row.last_payment_confirmed_at as string) : null,
      createdAt: new Date(row.created_at as string),
    })
  }
}
