-- Lead Memory expansion: temperature, purchase history, objections, recovery state
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_temperature       TEXT    NOT NULL DEFAULT 'cold'   CHECK (lead_temperature IN ('cold','warm','hot','vip')),
  ADD COLUMN IF NOT EXISTS purchased_titles       JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS preferred_genres       JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS objections             JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS abandoned_pix_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_state             TEXT,
  ADD COLUMN IF NOT EXISTS context_summary        TEXT,
  ADD COLUMN IF NOT EXISTS recovery_sent_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_temperature ON leads (bot_id, lead_temperature);
CREATE INDEX IF NOT EXISTS idx_leads_abandoned    ON leads (bot_id, abandoned_pix_count) WHERE abandoned_pix_count > 0;
