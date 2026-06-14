import type { Pool } from 'pg'
import type { AgentTraceRecord, AgentTraceRepository } from '@whatsbot/core'

// Persiste a trilha do agente. save() é non-blocking (auditoria nunca quebra a conversa).
export class PostgreSQLAgentTraceRepository implements AgentTraceRepository {
  constructor(private db: Pool) {}

  async save(r: AgentTraceRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_trace
         (bot_id, conversation_id, phone_number, turn_message, step, kind,
          tool_name, tool_input, result_code, result_success, text, stop_reason, provider, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        r.botId, r.conversationId ?? null, r.phoneNumber, r.turnMessage ?? null, r.step, r.kind,
        r.toolName ?? null, r.toolInput ? JSON.stringify(r.toolInput) : null,
        r.resultCode ?? null, r.resultSuccess ?? null, r.text ?? null, r.stopReason ?? null,
        r.provider ?? null, r.latencyMs ?? null,
      ],
    ).catch(err => {
      // Non-blocking — falha de auditoria não pode derrubar o fluxo principal
      console.error('[agent_trace] save failed:', err instanceof Error ? err.message : err)
    })
  }

  async listByConversation(conversationId: string): Promise<(AgentTraceRecord & { occurredAt: string })[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM agent_trace WHERE conversation_id = $1 ORDER BY occurred_at ASC, step ASC`,
      [conversationId],
    )
    return rows.map(row => ({
      botId: row.bot_id, conversationId: row.conversation_id, phoneNumber: row.phone_number,
      turnMessage: row.turn_message, step: row.step, kind: row.kind,
      toolName: row.tool_name, toolInput: row.tool_input, resultCode: row.result_code,
      resultSuccess: row.result_success, text: row.text, stopReason: row.stop_reason,
      provider: row.provider, latencyMs: row.latency_ms, occurredAt: row.occurred_at,
    }))
  }
}
