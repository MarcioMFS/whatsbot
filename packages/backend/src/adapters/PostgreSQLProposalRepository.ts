import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

// Proposta do plano Builder/Improver — IA propõe, NÃO aplica. Vive em flow_proposals até aprovação humana.
export type ProposalStatus = 'pending' | 'approved' | 'applied' | 'rejected' | 'stale'

export interface FlowProposal {
  id: string
  botId: string
  flowId: string | null
  kind: string
  targetRuntime: string | null
  proposedContent: Record<string, unknown>
  baselineMetrics: Record<string, unknown> | null
  baselineStamp: string | null
  status: ProposalStatus
  createdBy: string
  reviewedBy: string | null
  createdAt: Date
  reviewedAt: Date | null
}

export interface CreateProposalInput {
  botId: string
  flowId?: string | null
  kind: string
  targetRuntime?: string | null
  proposedContent: Record<string, unknown>
  baselineMetrics?: Record<string, unknown> | null
  baselineStamp?: string | null
  createdBy?: string
}

export class PostgreSQLProposalRepository {
  constructor(private db: Pool) {}

  async create(p: CreateProposalInput): Promise<FlowProposal> {
    const id = randomUUID()
    const { rows } = await this.db.query(
      `INSERT INTO flow_proposals
         (id, bot_id, flow_id, kind, target_runtime, proposed_content, baseline_metrics, baseline_stamp, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id, p.botId, p.flowId ?? null, p.kind, p.targetRuntime ?? null,
        JSON.stringify(p.proposedContent),
        p.baselineMetrics ? JSON.stringify(p.baselineMetrics) : null,
        p.baselineStamp ?? null,
        p.createdBy ?? 'ai',
      ],
    )
    return this.toDomain(rows[0])
  }

  async findById(id: string): Promise<FlowProposal | null> {
    const { rows } = await this.db.query('SELECT * FROM flow_proposals WHERE id = $1', [id])
    return rows[0] ? this.toDomain(rows[0]) : null
  }

  async listByBot(botId: string, status?: string): Promise<FlowProposal[]> {
    const { rows } = status
      ? await this.db.query('SELECT * FROM flow_proposals WHERE bot_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 200', [botId, status])
      : await this.db.query('SELECT * FROM flow_proposals WHERE bot_id = $1 ORDER BY created_at DESC LIMIT 200', [botId])
    return rows.map(r => this.toDomain(r))
  }

  async markReviewed(id: string, status: ProposalStatus, reviewedBy: string): Promise<void> {
    await this.db.query(
      'UPDATE flow_proposals SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3',
      [status, reviewedBy, id],
    )
  }

  private toDomain(r: Record<string, unknown>): FlowProposal {
    return {
      id: r.id as string,
      botId: r.bot_id as string,
      flowId: (r.flow_id as string | null) ?? null,
      kind: r.kind as string,
      targetRuntime: (r.target_runtime as string | null) ?? null,
      proposedContent: (r.proposed_content as Record<string, unknown>) ?? {},
      baselineMetrics: (r.baseline_metrics as Record<string, unknown> | null) ?? null,
      baselineStamp: (r.baseline_stamp as string | null) ?? null,
      status: r.status as ProposalStatus,
      createdBy: r.created_by as string,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      createdAt: r.created_at as Date,
      reviewedAt: (r.reviewed_at as Date | null) ?? null,
    }
  }
}
