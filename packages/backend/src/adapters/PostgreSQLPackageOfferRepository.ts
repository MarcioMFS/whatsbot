import type { Pool } from 'pg'
import { PackageOffer, type PackageOfferProps, type PackageOfferType, type PricingMode } from '@whatsbot/core'
import type { PackageOfferRepository } from '@whatsbot/core'

export class PostgreSQLPackageOfferRepository implements PackageOfferRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<PackageOffer | null> {
    const { rows } = await this.db.query('SELECT * FROM package_offers WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByBotId(botId: string, includeInactive = false): Promise<PackageOffer[]> {
    const query = includeInactive
      ? 'SELECT * FROM package_offers WHERE bot_id = $1 ORDER BY quantity ASC'
      : 'SELECT * FROM package_offers WHERE bot_id = $1 AND is_active = true ORDER BY quantity ASC'
    const { rows } = await this.db.query(query, [botId])
    return rows.map(r => this.toDomain(r))
  }

  async save(offer: PackageOffer): Promise<void> {
    const d = offer.toJSON()
    await this.db.query(
      `INSERT INTO package_offers (id, bot_id, name, description, type, pricing_mode, quantity, price_centavos, is_active, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         name=$3, description=$4, type=$5, pricing_mode=$6, quantity=$7,
         price_centavos=$8, is_active=$9, metadata=$10, updated_at=$12`,
      [d.id, d.botId, d.name, d.description ?? null, d.type, d.pricingMode,
       d.quantity, d.priceCentavos, d.isActive, JSON.stringify(d.metadata ?? {}),
       d.createdAt, d.updatedAt],
    )
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM package_offers WHERE id = $1', [id])
  }

  private toDomain(row: Record<string, unknown>): PackageOffer {
    return PackageOffer.reconstitute({
      id: row.id as string,
      botId: row.bot_id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      type: row.type as PackageOfferType,
      pricingMode: row.pricing_mode as PricingMode,
      quantity: row.quantity as number,
      priceCentavos: row.price_centavos as number,
      isActive: row.is_active as boolean,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    } as PackageOfferProps)
  }
}
