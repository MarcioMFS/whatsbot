-- Migração 022 — F0 do gerador evolutivo: instrumentar "o que confirma venda".
-- Materializa 1 desfecho por conversa + timestamp de pagamento em orders.
-- Aditiva e idempotente. Ver Brain/spec_gerador_evolutivo.md.

CREATE TABLE IF NOT EXISTS conversation_outcomes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id              UUID NOT NULL,
  conversation_id     UUID NOT NULL UNIQUE,            -- 1 desfecho por conversa (upsert)
  flow_id             UUID,
  pattern_set_version TEXT,                            -- qual versão de padrão gerou o flow (F3+)
  last_phase          TEXT,
  outcome             TEXT NOT NULL CHECK (outcome IN ('paid','abandoned','escalated','timeout','completed')),
  gmv_centavos        INTEGER,
  time_to_outcome_s   INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_outcomes_bot_outcome ON conversation_outcomes(bot_id, outcome);
CREATE INDEX IF NOT EXISTS idx_conv_outcomes_bot_created ON conversation_outcomes(bot_id, created_at DESC);

-- timestamp de quando a order virou paga (não existia; status='paid' já existe desde a migração 010)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
