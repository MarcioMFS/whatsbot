CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  price_centavos INTEGER NOT NULL CHECK (price_centavos > 0),
  category TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  access_link TEXT,
  aliases JSONB NOT NULL DEFAULT '[]',
  search_tokens JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_bot_id ON products(bot_id);
CREATE INDEX IF NOT EXISTS idx_products_bot_available ON products(bot_id, is_available);
CREATE INDEX IF NOT EXISTS idx_products_normalized ON products(bot_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_products_fts ON products USING gin(to_tsvector('portuguese', name));
