import type { Pool } from 'pg'
import { Handoff, type HandoffStatus, type HandoffProps } from '@whatsbot/core'
import type { HandoffRepository } from '@whatsbot/core'

export class PostgreSQLHandoffRepository implements HandoffRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<Handoff | null> {
    const { rows } = await this.db.query('SELECT * FROM handoffs WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByBotId(botId: string, status?: HandoffStatus, limit = 50, offset = 0): Promise<Handoff[]> {
    const { rows } = status
      ? await this.db.query(
          'SELECT * FROM handoffs WHERE bot_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
          [botId, status, limit, offset]
        )
      : await this.db.query(
          'SELECT * FROM handoffs WHERE bot_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
          [botId, limit, offset]
        )
    return rows.map(r => this.toDomain(r))
  }

  async countByBotId(botId: string, status?: HandoffStatus): Promise<number> {
    const { rows } = status
      ? await this.db.query('SELECT COUNT(*) FROM handoffs WHERE bot_id = $1 AND status = $2', [botId, status])
      : await this.db.query('SELECT COUNT(*) FROM handoffs WHERE bot_id = $1', [botId])
    return parseInt(rows[0].count, 10)
  }

  async findByConversationId(conversationId: string): Promise<Handoff[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM handoffs WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId]
    )
    return rows.map(r => this.toDomain(r))
  }

  async save(handoff: Handoff): Promise<void> {
    const d = handoff.toJSON()
    await this.db.query(
      `INSERT INTO handoffs (
        id, bot_id, conversation_id, lead_id, phone_number, reason,
        last_message, context_summary, lead_temperature, lead_tags,
        status, resolved_at, resolved_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        status       = EXCLUDED.status,
        resolved_at  = EXCLUDED.resolved_at,
        resolved_by  = EXCLUDED.resolved_by,
        updated_at   = EXCLUDED.updated_at`,
      [
        d.id, d.botId, d.conversationId, d.leadId, d.phoneNumber, d.reason,
        d.lastMessage, d.contextSummary, d.leadTemperature, d.leadTags,
        d.status, d.resolvedAt, d.resolvedBy, d.createdAt, d.updatedAt,
      ]
    )
  }

  private toDomain(row: Record<string, unknown>): Handoff {
    return Handoff.reconstitute({
      id: row.id as string,
      botId: row.bot_id as string,
      conversationId: row.conversation_id as string,
      leadId: row.lead_id as string | null,
      phoneNumber: row.phone_number as string,
      reason: row.reason as HandoffProps['reason'],
      lastMessage: row.last_message as string,
      contextSummary: row.context_summary as string | null,
      leadTemperature: row.lead_temperature as string,
      leadTags: (row.lead_tags as string[]) ?? [],
      status: row.status as HandoffStatus,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
      resolvedBy: row.resolved_by as string | null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    })
  }
}
