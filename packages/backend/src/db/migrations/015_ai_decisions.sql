CREATE TABLE IF NOT EXISTS ai_decisions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id            UUID NOT NULL,
  conversation_id   UUID,
  phone_number      TEXT NOT NULL,
  layer             TEXT NOT NULL,        -- 'ai_router' | 'payment_router' | 'catalog_search'
  input_message     TEXT NOT NULL,
  intent            TEXT,
  confidence        FLOAT,
  provider          TEXT,                 -- 'claude' | 'groq' | 'deterministic' | null
  duration_ms       INTEGER,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  used_fallback     BOOLEAN NOT NULL DEFAULT false,
  extra             JSONB NOT NULL DEFAULT '{}',
  is_error          BOOLEAN NOT NULL DEFAULT false,
  corrected_intent  TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_bot       ON ai_decisions (bot_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_phone     ON ai_decisions (bot_id, phone_number, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_layer     ON ai_decisions (bot_id, layer, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_intent    ON ai_decisions (bot_id, intent, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_errors    ON ai_decisions (bot_id, is_error, occurred_at DESC) WHERE is_error = true;
