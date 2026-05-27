-- Ensure no duplicate products per bot before adding constraint
DELETE FROM products p1
USING products p2
WHERE p1.bot_id = p2.bot_id
  AND p1.normalized_name = p2.normalized_name
  AND p1.created_at > p2.created_at;

-- Add unique constraint to prevent duplicate normalized names per bot
ALTER TABLE products
  ADD CONSTRAINT uq_products_bot_normalized UNIQUE (bot_id, normalized_name);
