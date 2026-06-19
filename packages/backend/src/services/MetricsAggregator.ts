import type { Pool } from 'pg'

// F1 do gerador evolutivo — agrega CONVERSÃO POR ETAPA, cross-bot, READ-ONLY (nunca escreve no runtime).
// Lê conversation_events (etapas) + conversation_outcomes (desfechos) e materializa funnel_metrics.
// É o painel global que alimenta o ranking de padrões do F2. Ver Brain/spec_gerador_evolutivo.md.

// Etapas do funil ↔ evento que as define. Constantes (NÃO entrada de usuário) — seguras no SQL.
const FUNNEL_STAGES = [
  { stage: 'started',  event: 'flow_started' },
  { stage: 'browsed',  event: 'catalog_searched' },
  { stage: 'cart',     event: 'product_added_to_cart' },
  { stage: 'checkout', event: 'checkout_initiated' },
  { stage: 'paid',     event: 'payment_approved' },
] as const

const OUTCOME_KEYS = ['paid', 'abandoned', 'escalated', 'timeout', 'completed'] as const

export interface FunnelStage { stage: string; order: number; count: number; convFromPrev: number | null }
export interface FunnelResult {
  windowDays: number
  conversations: number
  botsContributing: number
  stages: FunnelStage[]
  outcomes: Record<(typeof OUTCOME_KEYS)[number], number>
  gmvCentavos: number
}

// Conversão de cada etapa a partir da anterior (null na 1ª). Pode passar de 1.0 quando o funil
// não é estritamente aninhado (ex.: PIX via pacote sem checkout_initiated) — é informativo, não bug.
export function computeConversions(counts: number[]): (number | null)[] {
  return counts.map((c, i) => (i === 0 ? null : counts[i - 1] > 0 ? c / counts[i - 1] : null))
}

export class MetricsAggregator {
  constructor(private db: Pool) {}

  async computeFunnel(opts: { botId?: string; vertical?: string; windowDays: number }): Promise<FunnelResult> {
    const params: unknown[] = [opts.windowDays]
    let scope = ''
    if (opts.botId) { params.push(opts.botId); scope = `AND bot_id = $${params.length}::uuid` }
    else if (opts.vertical) { params.push(opts.vertical); scope = `AND bot_id IN (SELECT id FROM bots WHERE global_config->>'productNoun' = $${params.length})` }

    const filters = FUNNEL_STAGES.map((s, i) => `count(DISTINCT conversation_id) FILTER (WHERE event_type = '${s.event}') AS c${i}`).join(', ')
    const { rows } = await this.db.query(
      `SELECT ${filters}, count(DISTINCT bot_id) AS bots
       FROM conversation_events
       WHERE occurred_at >= now() - ($1 || ' days')::interval ${scope}`,
      params,
    )
    const counts = FUNNEL_STAGES.map((_, i) => Number(rows[0][`c${i}`]))
    const conv = computeConversions(counts)
    const stages = FUNNEL_STAGES.map((s, i) => ({ stage: s.stage, order: i, count: counts[i], convFromPrev: conv[i] }))

    const o = await this.db.query(
      `SELECT outcome, count(*)::int AS n, COALESCE(sum(gmv_centavos), 0)::bigint AS gmv
       FROM conversation_outcomes
       WHERE created_at >= now() - ($1 || ' days')::interval ${scope}
       GROUP BY outcome`,
      params,
    )
    const outcomes = Object.fromEntries(OUTCOME_KEYS.map(k => [k, 0])) as FunnelResult['outcomes']
    let gmvCentavos = 0
    for (const r of o.rows) {
      if (r.outcome in outcomes) outcomes[r.outcome as keyof typeof outcomes] = Number(r.n)
      gmvCentavos += Number(r.gmv)
    }

    return { windowDays: opts.windowDays, conversations: counts[0], botsContributing: Number(rows[0].bots), stages, outcomes, gmvCentavos }
  }

  // Materializa global + por-bot + por-vertical em funnel_metrics (consumido pelo F2).
  async refresh(windowDays = 30): Promise<{ scopes: number }> {
    let scopes = 0
    await this.materialize('global', '', windowDays, await this.computeFunnel({ windowDays })); scopes++
    const bots = await this.db.query('SELECT id FROM bots')
    for (const b of bots.rows) { await this.materialize('bot', b.id as string, windowDays, await this.computeFunnel({ botId: b.id as string, windowDays })); scopes++ }
    const verticals = await this.db.query(`SELECT DISTINCT global_config->>'productNoun' AS v FROM bots WHERE global_config->>'productNoun' IS NOT NULL AND global_config->>'productNoun' <> ''`)
    for (const r of verticals.rows) { await this.materialize('vertical', r.v as string, windowDays, await this.computeFunnel({ vertical: r.v as string, windowDays })); scopes++ }
    return { scopes }
  }

  private async materialize(scope: string, scopeKey: string, windowDays: number, f: FunnelResult): Promise<void> {
    for (const s of f.stages) {
      await this.db.query(
        `INSERT INTO funnel_metrics (scope, scope_key, window_days, stage, stage_order, reached_count, conv_from_prev, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (scope, scope_key, window_days, stage) DO UPDATE SET
           reached_count = EXCLUDED.reached_count, conv_from_prev = EXCLUDED.conv_from_prev,
           stage_order = EXCLUDED.stage_order, computed_at = now()`,
        [scope, scopeKey, windowDays, s.stage, s.order, s.count, s.convFromPrev],
      )
    }
  }
}
