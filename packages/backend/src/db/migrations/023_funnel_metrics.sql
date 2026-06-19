-- Migração 023 — F1 do gerador evolutivo: funil de conversão por etapa, cross-bot.
-- Materializado pelo MetricsAggregator (read-only sobre conversation_events + conversation_outcomes).
-- Uma linha por (escopo, etapa). Base do ranking de padrões do F2. Ver Brain/spec_gerador_evolutivo.md.

CREATE TABLE IF NOT EXISTS funnel_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         TEXT NOT NULL,                  -- 'global' | 'bot' | 'vertical'
  scope_key     TEXT NOT NULL DEFAULT '',       -- '' (global) | bot_id | vertical (productNoun)
  window_days   INTEGER NOT NULL,
  stage         TEXT NOT NULL,                  -- 'started'|'browsed'|'cart'|'checkout'|'paid'
  stage_order   INTEGER NOT NULL,
  reached_count INTEGER NOT NULL,
  conv_from_prev REAL,                          -- conversão a partir da etapa anterior (null na 1ª)
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_key, window_days, stage)
);

CREATE INDEX IF NOT EXISTS idx_funnel_metrics_scope ON funnel_metrics(scope, scope_key, window_days);
