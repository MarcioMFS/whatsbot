CREATE TABLE IF NOT EXISTS delivery_attempts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL,
  bot_id          UUID NOT NULL,
  conversation_id UUID,
  phone_number    TEXT NOT NULL,
  item_name       TEXT NOT NULL,
  access_link     TEXT,
  status          TEXT NOT NULL,   -- 'sent' | 'failed' | 'pending_link'
  error_message   TEXT,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delivery_bot        ON delivery_attempts (bot_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_order      ON delivery_attempts (order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_phone      ON delivery_attempts (bot_id, phone_number, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_failed     ON delivery_attempts (bot_id, status, attempted_at DESC) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_delivery_pending    ON delivery_attempts (bot_id, status, attempted_at DESC) WHERE status = 'pending_link';
