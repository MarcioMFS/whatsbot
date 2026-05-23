CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  amount INTEGER NOT NULL,              -- centavos (R$15,00 = 1500)
  receiver_key TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_bot ON payment_intents(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_conversation ON payment_intents(conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_lead ON payment_intents(lead_id, created_at DESC);
