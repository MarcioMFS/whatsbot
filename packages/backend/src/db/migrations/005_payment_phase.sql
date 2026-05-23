ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_payment_confirmed_at TIMESTAMPTZ;
