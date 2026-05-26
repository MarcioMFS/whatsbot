import type { Pool } from 'pg'
import { Product } from '@whatsbot/core'
import type { ProductRepository } from '@whatsbot/core'

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

export class PostgreSQLProductRepository implements ProductRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<Product | null> {
    const { rows } = await this.db.query('SELECT * FROM products WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByBotId(botId: string, includeUnavailable = false): Promise<Product[]> {
    const query = includeUnavailable
      ? 'SELECT * FROM products WHERE bot_id = $1 ORDER BY name'
      : 'SELECT * FROM products WHERE bot_id = $1 AND is_available = true ORDER BY name'
    const { rows } = await this.db.query(query, [botId])
    return rows.map(r => this.toDomain(r))
  }

  async search(botId: string, query: string, limit = 10): Promise<Product[]> {
    const normalized = normalizeText(query)
    const { rows } = await this.db.query(
      `SELECT *, similarity(normalized_name, $2) AS sim FROM products
       WHERE bot_id = $1 AND is_available = true
         AND (
           normalized_name = $2
           OR normalized_name ILIKE '%' || $2 || '%'
           OR $2 ILIKE '%' || normalized_name || '%'
           OR similarity(normalized_name, $2) > 0.42
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(aliases) alias
             WHERE alias ILIKE '%' || $2 || '%'
               OR $2 ILIKE '%' || alias || '%'
           )
         )
       ORDER BY sim DESC, name
       LIMIT $3`,
      [botId, normalized, limit],
    )
    return rows.map(r => this.toDomain(r))
  }

  async searchByCategory(botId: string, genre: string, typeHint: string, limit = 5): Promise<Product[]> {
    const g = genre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    const t = typeHint.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

    // unaccent() normalizes both sides so "ação" matches query "acao"
    // Score: category match = 2pts, name/description match = 1pt — deterministic, no RANDOM()
    const { rows } = await this.db.query(
      `SELECT *,
         (CASE WHEN $2 <> '' AND unaccent(lower(coalesce(category,''))) ILIKE '%' || $2 || '%' THEN 2 ELSE 0 END
          + CASE WHEN $3 <> '' AND unaccent(lower(name)) ILIKE '%' || $3 || '%' THEN 1 ELSE 0 END
          + CASE WHEN $3 <> '' AND unaccent(lower(coalesce(description,''))) ILIKE '%' || $3 || '%' THEN 1 ELSE 0 END
         ) AS relevance_score
       FROM products
       WHERE bot_id = $1 AND is_available = true
         AND (
           ($2 = '' OR unaccent(lower(coalesce(category,''))) ILIKE '%' || $2 || '%')
           OR ($3 = '' OR unaccent(lower(name)) ILIKE '%' || $3 || '%')
           OR ($3 = '' OR unaccent(lower(coalesce(description,''))) ILIKE '%' || $3 || '%')
         )
       ORDER BY relevance_score DESC, name ASC
       LIMIT $4`,
      [botId, g, t, limit],
    )
    return rows.map(r => this.toDomain(r))
  }

  async save(product: Product): Promise<void> {
    const d = product.toJSON()
    const normalizedName = normalizeText(d.name)
    const normalizedAliases = (d.aliases as string[]).map(normalizeText)
    await this.db.query(
      `INSERT INTO products
         (id, bot_id, name, normalized_name, description, price_centavos, category,
          is_available, access_link, aliases, search_tokens, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         normalized_name = EXCLUDED.normalized_name,
         description = EXCLUDED.description,
         price_centavos = EXCLUDED.price_centavos,
         category = EXCLUDED.category,
         is_available = EXCLUDED.is_available,
         access_link = EXCLUDED.access_link,
         aliases = EXCLUDED.aliases,
         search_tokens = EXCLUDED.search_tokens,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        d.id, d.botId, d.name, normalizedName, d.description ?? null,
        d.priceCentavos, d.category ?? null, d.isAvailable, d.accessLink ?? null,
        JSON.stringify(normalizedAliases), '[]', JSON.stringify(d.metadata),
        d.createdAt, d.updatedAt,
      ],
    )
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM products WHERE id = $1', [id])
  }

  private toDomain(row: Record<string, unknown>): Product {
    return Product.reconstitute({
      id: row.id as string,
      botId: row.bot_id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      priceCentavos: row.price_centavos as number,
      category: row.category as string | undefined,
      isAvailable: row.is_available as boolean,
      accessLink: row.access_link as string | undefined,
      aliases: (row.aliases as string[]) ?? [],
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    })
  }
}
