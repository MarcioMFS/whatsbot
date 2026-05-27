import type { Pool } from 'pg'

export interface AIDecisionRecord {
  botId: string
  conversationId?: string
  phoneNumber: string
  layer: 'ai_router' | 'payment_router' | 'catalog_search'
  inputMessage: string
  intent: string
  confidence?: number
  provider?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  usedFallback: boolean
  extra?: Record<string, unknown>
}

export class PostgreSQLAIDecisionRepository {
  constructor(private db: Pool) {}

  async save(record: AIDecisionRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_decisions
         (bot_id, conversation_id, phone_number, layer, input_message, intent,
          confidence, provider, duration_ms, input_tokens, output_tokens,
          used_fallback, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        record.botId,
        record.conversationId ?? null,
        record.phoneNumber,
        record.layer,
        record.inputMessage,
        record.intent,
        record.confidence ?? null,
        record.provider ?? null,
        record.durationMs ?? null,
        record.inputTokens ?? null,
        record.outputTokens ?? null,
        record.usedFallback,
        JSON.stringify(record.extra ?? {}),
      ],
    ).catch(err => {
      // Non-blocking — audit failure must never break the main flow
      console.error('[AIDecisionRepository] save failed:', err?.message)
    })
  }
}
