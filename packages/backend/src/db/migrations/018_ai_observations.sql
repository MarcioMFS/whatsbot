-- AI Observations: every routing decision is logged for continuous improvement
CREATE TABLE ai_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL,
  conversation_id UUID,
  phone_number TEXT NOT NULL,

  -- Input
  user_message TEXT NOT NULL,
  message_length INTEGER GENERATED ALWAYS AS (length(user_message)) STORED,
  has_image BOOLEAN NOT NULL DEFAULT false,

  -- Context
  phase TEXT,
  cart_count INTEGER DEFAULT 0,
  lead_temperature TEXT,
  lead_tags JSONB DEFAULT '[]',
  history_length INTEGER DEFAULT 0,

  -- Decision
  layer TEXT NOT NULL,
  selected_capability_id UUID REFERENCES capabilities(id) ON DELETE SET NULL,
  selected_capability_name TEXT,
  selected_intent TEXT,
  method TEXT NOT NULL,
  confidence REAL,
  reasoning TEXT,
  all_scores JSONB,
  matched_triggers JSONB DEFAULT '[]',

  -- Performance
  provider TEXT,
  model TEXT,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER DEFAULT 0,

  -- Outcome (filled later)
  outcome TEXT,
  outcome_reason TEXT,
  outcome_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_obs_bot_time ON ai_observations(bot_id, created_at DESC);
CREATE INDEX idx_obs_bot_layer ON ai_observations(bot_id, layer);
CREATE INDEX idx_obs_bot_method ON ai_observations(bot_id, method);
CREATE INDEX idx_obs_bot_confidence ON ai_observations(bot_id, confidence) WHERE confidence IS NOT NULL;
CREATE INDEX idx_obs_bot_outcome ON ai_observations(bot_id, outcome) WHERE outcome IS NOT NULL;
CREATE INDEX idx_obs_capability ON ai_observations(selected_capability_id) WHERE selected_capability_id IS NOT NULL;
CREATE INDEX idx_obs_fallback ON ai_observations(bot_id, created_at DESC)
  WHERE method = 'default' OR confidence < 0.6;
