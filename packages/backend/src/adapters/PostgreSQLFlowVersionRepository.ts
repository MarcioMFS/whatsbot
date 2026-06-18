import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

// Snapshot do flow ANTES de cada apply de proposta → rollback (corrige o UPSERT destrutivo do FlowRepository).
export interface FlowVersion {
  id: string
  flowId: string
  version: number
  nodes: unknown
  edges: unknown
  segments: unknown
  changedBy: string | null
  reason: string | null
  createdAt: Date
}

export class PostgreSQLFlowVersionRepository {
  constructor(private db: Pool) {}

  /** Salva o estado atual do flow como uma nova versão. Retorna o número da versão criada. */
  async snapshot(p: {
    flowId: string
    nodes: unknown
    edges: unknown
    segments?: unknown
    changedBy?: string | null
    reason?: string | null
  }): Promise<number> {
    const { rows } = await this.db.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS v FROM flow_versions WHERE flow_id = $1',
      [p.flowId],
    )
    const version = Number(rows[0]?.v ?? 1)
    await this.db.query(
      `INSERT INTO flow_versions (id, flow_id, version, nodes, edges, segments, changed_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(), p.flowId, version,
        JSON.stringify(p.nodes ?? []), JSON.stringify(p.edges ?? []),
        p.segments != null ? JSON.stringify(p.segments) : null,
        p.changedBy ?? null, p.reason ?? null,
      ],
    )
    return version
  }

  async listByFlow(flowId: string): Promise<FlowVersion[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM flow_versions WHERE flow_id = $1 ORDER BY version DESC LIMIT 50',
      [flowId],
    )
    return rows.map(r => ({
      id: r.id, flowId: r.flow_id, version: r.version,
      nodes: r.nodes, edges: r.edges, segments: r.segments,
      changedBy: r.changed_by, reason: r.reason, createdAt: r.created_at,
    }))
  }
}
