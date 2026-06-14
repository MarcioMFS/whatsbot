-- Trilha durável do AgentRuntime: quem foi chamado, com quais argumentos, o que voltou.
-- Auditoria do agente (não vivia em banco — só log efêmero). Ver Brain/spec_escape_hatch.md / agente.
CREATE TABLE IF NOT EXISTS agent_trace (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          uuid NOT NULL,
  conversation_id uuid,
  phone_number    text NOT NULL,
  turn_message    text,                 -- mensagem do cliente que disparou o turno
  step            int  NOT NULL,
  kind            text NOT NULL,        -- 'tool' | 'reply' | 'error'
  tool_name       text,
  tool_input      jsonb,
  result_code     text,
  result_success  boolean,
  text            text,                 -- texto do assistant (reply) / mensagem de erro
  stop_reason     text,
  provider        text,
  latency_ms      int,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_trace_conv ON agent_trace (conversation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_agent_trace_bot ON agent_trace (bot_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_trace_tool ON agent_trace (tool_name, occurred_at DESC);
