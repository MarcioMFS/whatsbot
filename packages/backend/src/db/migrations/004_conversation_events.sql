CREATE TABLE IF NOT EXISTS conversation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL,
  conversation_id UUID,
  phone_number TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_events_bot ON conversation_events(bot_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_events_phone ON conversation_events(bot_id, phone_number, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_events_type ON conversation_events(bot_id, event_type, occurred_at DESC);
