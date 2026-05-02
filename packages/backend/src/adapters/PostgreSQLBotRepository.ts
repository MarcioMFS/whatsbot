import type { Pool } from 'pg'
import { Bot } from '@whatsbot/core'
import type { BotRepository } from '@whatsbot/core'

export class PostgreSQLBotRepository implements BotRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<Bot | null> {
    const { rows } = await this.db.query('SELECT * FROM bots WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByOwnerId(ownerId: string): Promise<Bot[]> {
    const { rows } = await this.db.query('SELECT * FROM bots WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId])
    return rows.map(r => this.toDomain(r))
  }

  async findByInstanceName(instanceName: string): Promise<Bot | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM bots WHERE evolution_config->>'instanceName' = $1",
      [instanceName]
    )
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async save(bot: Bot): Promise<void> {
    const data = bot.toJSON()
    await this.db.query(
      `INSERT INTO bots (id, name, product_info, ai_config, evolution_config, active_flow_id, is_active, webhook_secret, owner_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         name=$2, product_info=$3, ai_config=$4, evolution_config=$5,
         active_flow_id=$6, is_active=$7, webhook_secret=$8, updated_at=$11`,
      [
        data.id, data.name,
        JSON.stringify(data.productInfo),
        JSON.stringify(data.aiConfig),
        JSON.stringify(data.evolutionConfig),
        data.activeFlowId,
        data.isActive,
        data.webhookSecret,
        data.ownerId,
        data.createdAt,
        data.updatedAt,
      ]
    )
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM bots WHERE id = $1', [id])
  }

  private toDomain(row: Record<string, unknown>): Bot {
    return Bot.reconstitute({
      id: row.id as string,
      name: row.name as string,
      productInfo: row.product_info as ReturnType<Bot['toJSON']>['productInfo'],
      aiConfig: row.ai_config as ReturnType<Bot['toJSON']>['aiConfig'],
      evolutionConfig: row.evolution_config as ReturnType<Bot['toJSON']>['evolutionConfig'],
      activeFlowId: row.active_flow_id as string | null,
      isActive: row.is_active as boolean,
      webhookSecret: row.webhook_secret as string,
      ownerId: row.owner_id as string,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    })
  }
}
