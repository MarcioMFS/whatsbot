import type { Pool } from 'pg'
import { Flow } from '@whatsbot/core'
import type { FlowRepository } from '@whatsbot/core'

export class PostgreSQLFlowRepository implements FlowRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<Flow | null> {
    const { rows } = await this.db.query('SELECT * FROM flows WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async findByBotId(botId: string): Promise<Flow[]> {
    const { rows } = await this.db.query('SELECT * FROM flows WHERE bot_id = $1 ORDER BY created_at DESC', [botId])
    return rows.map(r => this.toDomain(r))
  }

  async save(flow: Flow): Promise<void> {
    const data = flow.toJSON()
    await this.db.query(
      `INSERT INTO flows (id, bot_id, name, nodes, edges, segments, is_default, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name=$3, nodes=$4, edges=$5, segments=$6, is_default=$7, updated_at=$9`,
      [
        data.id, data.botId, data.name,
        JSON.stringify(data.nodes),
        JSON.stringify(data.edges),
        JSON.stringify(data.segments ?? []),
        data.isDefault,
        data.createdAt,
        data.updatedAt,
      ]
    )
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM flows WHERE id = $1', [id])
  }

  private toDomain(row: Record<string, unknown>): Flow {
    return Flow.reconstitute({
      id: row.id as string,
      botId: row.bot_id as string,
      name: row.name as string,
      nodes: row.nodes as ReturnType<Flow['toJSON']>['nodes'],
      edges: row.edges as ReturnType<Flow['toJSON']>['edges'],
      segments: (row.segments ?? []) as ReturnType<Flow['toJSON']>['segments'],
      isDefault: row.is_default as boolean,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    })
  }
}
