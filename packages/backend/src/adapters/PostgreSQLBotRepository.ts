import type { Pool } from 'pg'
import { Bot, type FlowRoutingRule, type BotGlobalConfig } from '@whatsbot/core'
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

  async findAllActive(): Promise<Bot[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM bots WHERE is_active = true ORDER BY created_at DESC'
    )
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
      `INSERT INTO bots (id, name, product_info, ai_config, evolution_config, active_flow_id, routing_rules, global_config, is_active, webhook_secret, owner_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         name=$2, product_info=$3, ai_config=$4, evolution_config=$5,
         active_flow_id=$6, routing_rules=$7, global_config=$8, is_active=$9, webhook_secret=$10, updated_at=$13`,
      [
        data.id, data.name,
        JSON.stringify(data.productInfo),
        JSON.stringify(data.aiConfig),
        JSON.stringify(data.evolutionConfig),
        data.activeFlowId,
        JSON.stringify(data.routingRules),
        JSON.stringify(data.globalConfig),
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
      routingRules: (row.routing_rules as FlowRoutingRule[]) ?? [],
      globalConfig: (row.global_config as BotGlobalConfig) ?? {},
      isActive: row.is_active as boolean,
      webhookSecret: row.webhook_secret as string,
      ownerId: row.owner_id as string,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    })
  }
}
