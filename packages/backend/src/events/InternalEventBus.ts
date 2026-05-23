import type { Pool } from 'pg'

type AnyEvent = { type: string; botId: string; occurredAt: Date }
type Handler<T> = (event: T) => Promise<void>

/**
 * In-process, typed event bus.
 *
 * Design decisions:
 * - Handlers run async in parallel (Promise.allSettled — no one handler blocks another)
 * - Failed handlers are logged but do NOT throw (bus must not break the main flow)
 * - All events are persisted to PostgreSQL before handlers fire (event store = source of truth)
 * - For scale: swap PostgreSQL persistence for an outbox table + BullMQ consumer
 */
export class InternalEventBus {
  private handlers = new Map<string, Handler<unknown>[]>()

  constructor(private db: Pool) {}

  on<T extends AnyEvent>(eventType: T['type'], handler: Handler<T>): void {
    const existing = this.handlers.get(eventType) ?? []
    this.handlers.set(eventType, [...existing, handler as Handler<unknown>])
  }

  async emit<T extends AnyEvent>(event: T): Promise<void> {
    // 1. Persist first (event store = source of truth)
    try {
      await this.persist(event)
    } catch (err) {
      console.error(`[EventBus] CRITICAL: failed to persist event ${event.type}`, err)
      // Still fire handlers — persistence failure should not block operational flow
    }

    // 2. Fire handlers in parallel, isolated
    const handlers = this.handlers.get(event.type) ?? []
    const results = await Promise.allSettled(handlers.map(h => h(event)))
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[EventBus] handler failed for ${event.type}:`, result.reason)
      }
    }
  }

  private async persist(event: AnyEvent): Promise<void> {
    const { type, botId, occurredAt, ...payload } = event
    await this.db.query(
      `INSERT INTO conversation_events (bot_id, conversation_id, phone_number, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        botId,
        (payload as Record<string, unknown>)['conversationId'] ?? null,
        (payload as Record<string, unknown>)['phoneNumber'] ?? '',
        type,
        JSON.stringify(payload),
        occurredAt,
      ],
    )
  }
}
