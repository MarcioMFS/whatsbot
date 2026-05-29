import type { Pool } from 'pg'
import { Capability } from '@whatsbot/core'
import type { CapabilityRepository, CapabilityProps } from '@whatsbot/core'

export class PostgreSQLCapabilityRepository implements CapabilityRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<Capability | null> {
    const { rows } = await this.db.query('SELECT * FROM capabilities WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByBotId(botId: string): Promise<Capability[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM capabilities WHERE bot_id = $1 ORDER BY priority DESC, name',
      [botId],
    )
    return rows.map(r => this.toDomain(r))
  }

  async findEnabledByBotId(botId: string): Promise<Capability[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM capabilities WHERE bot_id = $1 AND is_enabled = true ORDER BY priority DESC, name',
      [botId],
    )
    return rows.map(r => this.toDomain(r))
  }

  async save(capability: Capability): Promise<void> {
    const d = capability.toJSON()
    await this.db.query(
      `INSERT INTO capabilities
         (id, bot_id, name, description, examples, exclusions, triggers, flow_id,
          is_default, is_enabled, priority, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         examples = EXCLUDED.examples,
         exclusions = EXCLUDED.exclusions,
         triggers = EXCLUDED.triggers,
         flow_id = EXCLUDED.flow_id,
         is_default = EXCLUDED.is_default,
         is_enabled = EXCLUDED.is_enabled,
         priority = EXCLUDED.priority,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        d.id, d.botId, d.name, d.description,
        JSON.stringify(d.examples), JSON.stringify(d.exclusions), JSON.stringify(d.triggers),
        d.flowId, d.isDefault, d.isEnabled, d.priority,
        JSON.stringify(d.metadata), d.createdAt, d.updatedAt,
      ],
    )
  }

  async update(id: string, data: Partial<CapabilityProps>): Promise<Capability> {
    const fields: string[] = []
    const values: unknown[] = []
    let idx = 1

    const colMap: Record<string, string> = {
      name: 'name', description: 'description', flowId: 'flow_id',
      isDefault: 'is_default', isEnabled: 'is_enabled', priority: 'priority',
    }
    const jsonCols = new Set(['examples', 'exclusions', 'triggers', 'metadata'])

    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue
      const col = colMap[key] ?? key
      fields.push(`${col} = $${idx++}`)
      values.push(jsonCols.has(key) ? JSON.stringify(val) : val)
    }

    if (fields.length === 0) {
      const cap = await this.findById(id)
      if (!cap) throw new Error(`Capability ${id} not found`)
      return cap
    }

    fields.push(`updated_at = now()`)
    values.push(id)

    const { rows } = await this.db.query(
      `UPDATE capabilities SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    )
    return this.toDomain(rows[0])
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM capabilities WHERE id = $1', [id])
  }

  async clearDefault(botId: string): Promise<void> {
    await this.db.query(
      'UPDATE capabilities SET is_default = false WHERE bot_id = $1 AND is_default = true',
      [botId],
    )
  }

  private toDomain(row: Record<string, unknown>): Capability {
    return Capability.restore({
      id: row.id as string,
      botId: row.bot_id as string,
      name: row.name as string,
      description: row.description as string,
      examples: (row.examples as string[]) ?? [],
      exclusions: (row.exclusions as string[]) ?? [],
      triggers: (row.triggers as CapabilityProps['triggers']) ?? [],
      flowId: row.flow_id as string,
      isDefault: row.is_default as boolean,
      isEnabled: row.is_enabled as boolean,
      priority: row.priority as number,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    })
  }
}
