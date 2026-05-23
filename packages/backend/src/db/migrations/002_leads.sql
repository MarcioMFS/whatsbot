CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  name TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  variables JSONB NOT NULL DEFAULT '{}',
  total_sessions INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bot_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_leads_bot ON leads(bot_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(bot_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_leads_tags ON leads USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_leads_last_seen ON leads(bot_id, last_seen_at DESC);
