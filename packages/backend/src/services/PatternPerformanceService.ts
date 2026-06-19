import type { Pool } from 'pg'
import { wilsonLowerBound, passesKAnonymity } from './PatternDistiller.js'

// F4 do gerador evolutivo — fecha o loop: mede conversão por pattern_set_version (flows gerados →
// conversas → outcomes) e PROMOVE/APOSENTA padrões CANDIDATE por dado, não por fé. Dormente até
// haver candidates (F2) + volume (k-anon). Ver Brain/spec_gerador_evolutivo.md.

export type PatternFate = 'promote' | 'retire' | 'keep'

// Decisão PURA pela performance medida. baseline = conversão geral. Exige evidência (k-anon) antes
// de mexer; promove só com folga sobre o baseline (lower bound de Wilson, não a média otimista).
export function decidePatternFate(wilsonLower: number, baselineConv: number, nObs: number, nBots: number): PatternFate {
  if (!passesKAnonymity(nObs, nBots)) return 'keep'   // sem evidência suficiente → não mexe
  if (baselineConv <= 0) return 'keep'
  if (wilsonLower >= baselineConv * 1.1) return 'promote'  // bate o baseline com folga
  if (wilsonLower < baselineConv * 0.7) return 'retire'    // claramente pior
  return 'keep'
}

export interface VersionPerf {
  patternSetVersion: string; total: number; bots: number; conversions: number
  convRate: number; wilsonLower: number; lift: number
}

export class PatternPerformanceService {
  constructor(private db: Pool) {}

  private async baseline(windowDays: number): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT count(*)::int total, count(*) FILTER (WHERE outcome='paid')::int paid
       FROM conversation_outcomes WHERE created_at >= now() - ($1 || ' days')::interval`,
      [windowDays],
    )
    return rows[0].total > 0 ? rows[0].paid / rows[0].total : 0
  }

  // Conversão por VERSÃO de padrões: flows carimbados → conversas → outcomes. Read-only.
  async evaluateVersions(windowDays = 90): Promise<{ baseline: number; versions: VersionPerf[] }> {
    const baseline = await this.baseline(windowDays)
    const { rows } = await this.db.query(
      `SELECT f.pattern_set_version AS v, count(*)::int AS total,
              count(DISTINCT co.bot_id)::int AS bots,
              count(*) FILTER (WHERE co.outcome='paid')::int AS paid
       FROM conversation_outcomes co JOIN flows f ON f.id = co.flow_id
       WHERE f.pattern_set_version IS NOT NULL AND co.created_at >= now() - ($1 || ' days')::interval
       GROUP BY f.pattern_set_version`,
      [windowDays],
    )
    const versions: VersionPerf[] = rows.map(r => {
      const convRate = r.total > 0 ? r.paid / r.total : 0
      return { patternSetVersion: r.v, total: r.total, bots: r.bots, conversions: r.paid, convRate,
        wilsonLower: wilsonLowerBound(r.paid, r.total), lift: baseline > 0 ? convRate / baseline : 0 }
    })
    return { baseline, versions }
  }

  // Promove/aposenta padrões CANDIDATE pela performance agregada das versões que os usaram.
  async run(windowDays = 90): Promise<{ baseline: number; evaluated: number; promoted: number; retired: number; note: string }> {
    const baseline = await this.baseline(windowDays)
    const cands = await this.db.query("SELECT id FROM winning_patterns WHERE status = 'candidate'")
    let promoted = 0, retired = 0
    for (const c of cands.rows) {
      const { rows } = await this.db.query(
        `SELECT count(*)::int AS total, count(DISTINCT co.bot_id)::int AS bots,
                count(*) FILTER (WHERE co.outcome='paid')::int AS paid
         FROM pattern_set_members m
         JOIN flows f ON f.pattern_set_version = m.pattern_set_version
         JOIN conversation_outcomes co ON co.flow_id = f.id
         WHERE m.pattern_id = $1 AND co.created_at >= now() - ($2 || ' days')::interval`,
        [c.id, windowDays],
      )
      const total = rows[0].total as number, bots = rows[0].bots as number, paid = rows[0].paid as number
      const wl = wilsonLowerBound(paid, total)
      const lift = baseline > 0 && total > 0 ? (paid / total) / baseline : 0
      await this.db.query(
        `INSERT INTO pattern_stats (pattern_id, n_observations, n_bots, conversions, lift, wilson_lower, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (pattern_id) DO UPDATE SET
           n_observations=$2, n_bots=$3, conversions=$4, lift=$5, wilson_lower=$6, updated_at=now()`,
        [c.id, total, bots, paid, lift, wl],
      )
      const fate = decidePatternFate(wl, baseline, total, bots)
      if (fate === 'promote') { await this.db.query("UPDATE winning_patterns SET status='promoted', updated_at=now() WHERE id=$1", [c.id]); promoted++ }
      else if (fate === 'retire') { await this.db.query("UPDATE winning_patterns SET status='retired', updated_at=now() WHERE id=$1", [c.id]); retired++ }
    }
    const note = cands.rows.length === 0
      ? 'Sem padrões candidate (F2 ainda não destilou). Motor armado; liga com volume.'
      : `${cands.rows.length} candidatos avaliados → ${promoted} promovidos, ${retired} aposentados.`
    return { baseline, evaluated: cands.rows.length, promoted, retired, note }
  }
}
