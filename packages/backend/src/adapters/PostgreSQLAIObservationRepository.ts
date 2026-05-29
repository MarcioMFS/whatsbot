import type { Pool } from 'pg'
import type { AIObservation, AIObservationRepository } from '@whatsbot/core'

export class PostgreSQLAIObservationRepository implements AIObservationRepository {
  constructor(private db: Pool) {}

  async save(obs: AIObservation): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_observations
         (bot_id, conversation_id, phone_number, user_message, has_image,
          phase, cart_count, lead_tags, history_length,
          layer, selected_capability_id, selected_capability_name, selected_intent,
          method, confidence, reasoning, all_scores, matched_triggers,
          provider, model, duration_ms, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        obs.botId,
        obs.conversationId ?? null,
        obs.phoneNumber,
        obs.userMessage,
        obs.hasImage,
        obs.phase ?? null,
        obs.cartCount ?? 0,
        JSON.stringify(obs.leadTags ?? []),
        obs.historyLength ?? 0,
        obs.layer,
        obs.selectedCapabilityId ?? null,
        obs.selectedCapabilityName ?? null,
        obs.selectedIntent ?? null,
        obs.method,
        obs.confidence ?? null,
        obs.reasoning ?? null,
        obs.allScores ? JSON.stringify(obs.allScores) : null,
        JSON.stringify(obs.matchedTriggers ?? []),
        obs.provider ?? null,
        obs.model ?? null,
        obs.durationMs ?? null,
        obs.inputTokens ?? null,
        obs.outputTokens ?? null,
      ],
    )
  }

  async findByBotId(botId: string, limit = 100): Promise<AIObservation[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM ai_observations WHERE bot_id = $1 ORDER BY created_at DESC LIMIT $2',
      [botId, limit],
    )
    return rows.map(r => this.toDomain(r))
  }

  async findProblematic(botId: string, days: number): Promise<AIObservation[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM ai_observations
       WHERE bot_id = $1
         AND created_at > now() - ($2 || ' days')::interval
         AND (method = 'default' OR confidence < 0.6)
       ORDER BY created_at DESC
       LIMIT 1000`,
      [botId, days],
    )
    return rows.map(r => this.toDomain(r))
  }

  async updateOutcome(id: string, outcome: string, reason?: string): Promise<void> {
    await this.db.query(
      'UPDATE ai_observations SET outcome = $1, outcome_reason = $2, outcome_at = now() WHERE id = $3',
      [outcome, reason ?? null, id],
    )
  }

  private toDomain(row: Record<string, unknown>): AIObservation {
    return {
      id: row.id as string,
      botId: row.bot_id as string,
      conversationId: row.conversation_id as string | undefined,
      phoneNumber: row.phone_number as string,
      userMessage: row.user_message as string,
      hasImage: row.has_image as boolean,
      phase: row.phase as string | undefined,
      cartCount: row.cart_count as number | undefined,
      leadTags: (row.lead_tags as string[]) ?? [],
      historyLength: row.history_length as number | undefined,
      layer: row.layer as string,
      selectedCapabilityId: row.selected_capability_id as string | undefined,
      selectedCapabilityName: row.selected_capability_name as string | undefined,
      selectedIntent: row.selected_intent as string | undefined,
      method: row.method as string,
      confidence: row.confidence as number | undefined,
      reasoning: row.reasoning as string | undefined,
      allScores: (row.all_scores as Record<string, number>) ?? undefined,
      matchedTriggers: (row.matched_triggers as string[]) ?? [],
      provider: row.provider as string | undefined,
      model: row.model as string | undefined,
      durationMs: row.duration_ms as number | undefined,
      inputTokens: row.input_tokens as number | undefined,
      outputTokens: row.output_tokens as number | undefined,
      outcome: row.outcome as string | undefined,
      outcomeReason: row.outcome_reason as string | undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}
