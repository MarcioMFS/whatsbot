// Trilha durável do AgentRuntime — auditoria de "quem foi chamado, como, o que voltou".
// Ver migration 020_agent_trace.sql.

export interface AgentTraceRecord {
  botId: string
  conversationId?: string | null
  phoneNumber: string
  turnMessage?: string | null
  step: number
  kind: 'tool' | 'reply' | 'error' | 'nudge'
  toolName?: string | null
  toolInput?: Record<string, unknown> | null
  resultCode?: string | null
  resultSuccess?: boolean | null
  text?: string | null
  stopReason?: string | null
  provider?: string | null
  latencyMs?: number | null
}

export interface AgentTraceRepository {
  save(record: AgentTraceRecord): Promise<void>
  listByConversation(conversationId: string): Promise<(AgentTraceRecord & { occurredAt: string })[]>
  listByBot(botId: string, limit: number): Promise<(AgentTraceRecord & { occurredAt: string })[]>
}
