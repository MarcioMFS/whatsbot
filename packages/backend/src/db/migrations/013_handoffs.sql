CREATE TABLE IF NOT EXISTS handoffs (
  id                UUID        PRIMARY KEY,
  bot_id            UUID        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id   TEXT        NOT NULL,
  lead_id           UUID        REFERENCES leads(id) ON DELETE SET NULL,
  phone_number      TEXT        NOT NULL,
  reason            TEXT        NOT NULL,
  last_message      TEXT        NOT NULL DEFAULT '',
  context_summary   TEXT,
  lead_temperature  TEXT        NOT NULL DEFAULT 'cold',
  lead_tags         TEXT[]      NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','ignored')),
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handoffs_bot_status  ON handoffs (bot_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handoffs_conversation ON handoffs (conversation_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_phone        ON handoffs (bot_id, phone_number);
