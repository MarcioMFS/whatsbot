import type { Pool } from 'pg'
import type { ConversationOutcome, ConversationOutcomeType, ConversationOutcomeRepository } from '@whatsbot/core'

const OUTCOMES: ConversationOutcomeType[] = ['paid', 'abandoned', 'escalated', 'timeout', 'completed']

export class PostgreSQLConversationOutcomeRepository implements ConversationOutcomeRepository {
  constructor(private db: Pool) {}

  async record(o: ConversationOutcome): Promise<void> {
    // Idempotente por conversa. Um desfecho posterior sobrescreve, EXCETO se já está 'paid'
    // (venda é terminal e não pode ser rebaixada por um timeout/handoff que venha depois).
    await this.db.query(
      `INSERT INTO conversation_outcomes
         (bot_id, conversation_id, flow_id, pattern_set_version, last_phase, outcome, gmv_centavos, time_to_outcome_s)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (conversation_id) DO UPDATE SET
         outcome = EXCLUDED.outcome,
         last_phase = EXCLUDED.last_phase,
         gmv_centavos = COALESCE(EXCLUDED.gmv_centavos, conversation_outcomes.gmv_centavos),
         pattern_set_version = COALESCE(EXCLUDED.pattern_set_version, conversation_outcomes.pattern_set_version),
         created_at = now()
       WHERE conversation_outcomes.outcome <> 'paid'`,
      [o.botId, o.conversationId, o.flowId ?? null, o.patternSetVersion ?? null, o.lastPhase ?? null, o.outcome, o.gmvCentavos ?? null, o.timeToOutcomeS ?? null],
    )
  }

  async getStats(botId: string, since: Date): Promise<Record<ConversationOutcomeType, number>> {
    const { rows } = await this.db.query(
      `SELECT outcome, COUNT(*)::int AS n FROM conversation_outcomes
       WHERE bot_id = $1 AND created_at >= $2 GROUP BY outcome`,
      [botId, since],
    )
    const out = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<ConversationOutcomeType, number>
    for (const r of rows) out[r.outcome as ConversationOutcomeType] = Number(r.n)
    return out
  }
}
