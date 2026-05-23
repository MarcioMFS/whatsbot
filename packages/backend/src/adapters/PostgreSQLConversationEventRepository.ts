import type { Pool } from 'pg'
import type { ConversationEvent, ConversationEventType } from '@whatsbot/core'
import type { ConversationEventRepository } from '@whatsbot/core'

export class PostgreSQLConversationEventRepository implements ConversationEventRepository {
  constructor(private db: Pool) {}

  async emit(event: ConversationEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO conversation_events (bot_id, conversation_id, phone_number, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event.botId, event.conversationId, event.phoneNumber, event.eventType, JSON.stringify(event.payload), event.occurredAt],
    )
  }

  async findByBot(botId: string, limit = 100): Promise<ConversationEvent[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM conversation_events WHERE bot_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [botId, limit],
    )
    return rows.map(this.toDomain)
  }

  async findByPhone(botId: string, phoneNumber: string): Promise<ConversationEvent[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM conversation_events WHERE bot_id = $1 AND phone_number = $2 ORDER BY occurred_at DESC`,
      [botId, phoneNumber],
    )
    return rows.map(this.toDomain)
  }

  async countByType(botId: string, eventType: ConversationEventType, since: Date): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*) FROM conversation_events WHERE bot_id = $1 AND event_type = $2 AND occurred_at >= $3`,
      [botId, eventType, since],
    )
    return parseInt(rows[0].count, 10)
  }

  private toDomain(row: Record<string, unknown>): ConversationEvent {
    return {
      botId: row.bot_id as string,
      conversationId: row.conversation_id as string,
      phoneNumber: row.phone_number as string,
      eventType: row.event_type as ConversationEventType,
      payload: row.payload as Record<string, unknown>,
      occurredAt: new Date(row.occurred_at as string),
    }
  }
}
