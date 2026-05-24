-- PackageOffer: pricing rules applied to the cart, NOT to products.
-- Product is always the source of truth for catalog, delivery, and analytics.
-- PackageOffer only modifies the final cart price based on quantity.

CREATE TABLE IF NOT EXISTS package_offers (
  id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL DEFAULT 'quantity_bundle',
  pricing_mode VARCHAR(50) NOT NULL DEFAULT 'minimum_quantity',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_centavos INTEGER NOT NULL CHECK (price_centavos > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_package_offers_bot_id ON package_offers(bot_id);
CREATE INDEX IF NOT EXISTS idx_package_offers_active ON package_offers(bot_id, is_active) WHERE is_active = true;
