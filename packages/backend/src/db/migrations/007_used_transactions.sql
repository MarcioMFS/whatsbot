-- Stores every transactionId + receipt fingerprint that approved a payment.
-- Append-only: never update or delete rows here (audit trail).
CREATE TABLE IF NOT EXISTS used_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL,
  transaction_id TEXT NOT NULL,
  payment_intent_id UUID NOT NULL,
  receipt_fingerprint TEXT NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_used_tx_bot_txid ON used_transactions(bot_id, transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_used_tx_bot_fp ON used_transactions(bot_id, receipt_fingerprint);
CREATE INDEX IF NOT EXISTS idx_used_tx_bot ON used_transactions(bot_id, used_at DESC);
