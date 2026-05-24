CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  payment_intent_id UUID REFERENCES payment_intents(id),
  items JSONB NOT NULL DEFAULT '[]',
  total_centavos INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','delivery_pending','delivered','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_bot_id ON orders(bot_id);
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON orders(conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(bot_id, status);
