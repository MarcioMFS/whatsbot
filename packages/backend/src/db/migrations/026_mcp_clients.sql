-- Migração 026 — WhatsBot MCP (onda 1): clients de serviço do servidor MCP.
-- Cada token é escopado a um dono + bots permitidos + escopo de tools (read|send|action).
-- Ver Brain/Projetos/WhatsBot/spec_whatsbot_mcp.md.

CREATE TABLE IF NOT EXISTS mcp_clients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token        TEXT NOT NULL UNIQUE,
  owner_id     UUID NOT NULL,
  name         TEXT,
  allowed_bots JSONB,                       -- null = todos os bots do dono
  scopes       JSONB NOT NULL DEFAULT '["read"]'::jsonb,  -- subconjunto de read|send|action
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_clients_token ON mcp_clients(token);
