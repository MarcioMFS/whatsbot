import type { Pool } from 'pg'

// F2 do gerador evolutivo — "ImproverService AO CONTRÁRIO": em vez de ler o que dá ERRADO,
// destila o que CONVERTE em padrões vencedores ANÔNIMOS, e mantém um store VIVO (winning_patterns)
// que substitui o sales_skills_mining.md estático. Roda OFFLINE (nunca no hot-path). Consumido pelo F3.
// Ver Brain/spec_gerador_evolutivo.md.

// k-anonymity: um padrão DESTILADO só vira candidate com volume mínimo de ≥2 bots distintos —
// senão é o estilo de UM tenant (vaza copy proprietária). Seed do playbook é isento (é genérico).
const K_MIN_OBS = 20
const K_MIN_BOTS = 2

// Lower bound de Wilson — não premia padrão com n pequeno (7/10 ≠ 700/1000). z=1.96 (95%).
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0
  const p = successes / total
  const z2 = z * z
  const denom = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  return Math.max(0, (centre - margin) / denom)
}

// Decisão pura de k-anonymity (testável).
export function passesKAnonymity(nObservations: number, nBots: number): boolean {
  return nObservations >= K_MIN_OBS && nBots >= K_MIN_BOTS
}

export interface SeedPattern { field: string; bucket: string; guidance: string; sampleTextAnon: string }

// SEED = Tier-1 do playbook sales_skills_mining.md reclassificado por campo do FlowBrief.
// Genérico por construção (sem marca/preço/produto) → seguro como conhecimento global.
export const PLAYBOOK_SEED: SeedPattern[] = [
  { field: 'introMessage', bucket: 'hook_warm',
    guidance: 'Abra com saudação calorosa + UM gancho da promessa principal. Espelhe o tom do cliente. SEM preço, bônus ou "de R$X por R$Y" na primeira mensagem.',
    sampleTextAnon: 'Oi! 😊 Que bom te ver por aqui — posso te mostrar rapidinho como isso pode te ajudar?' },
  { field: 'askMessage', bucket: 'micro_commitment',
    guidance: 'Faça uma pergunta que oferece ESCOLHA em vez de sim/não, pra ganhar um micro-compromisso e fazer a pessoa responder.',
    sampleTextAnon: 'Prefere que eu te explique como funciona ou já te mostro as opções?' },
  { field: 'offerMessage', bucket: 'social_proof',
    guidance: 'Use prova social no máximo 1x por mensagem e só se for REAL (ex.: "o mais escolhido"); nunca invente número.',
    sampleTextAnon: 'Esse costuma ser o preferido de quem busca esse tipo de resultado.' },
  { field: 'offerMessage', bucket: 'no_fake_urgency',
    guidance: 'NUNCA invente prazo, data ou promoção. Urgência só verdadeira e ligada à entrega ("assim que cair o pagamento, já libero").',
    sampleTextAnon: 'Assim que o pagamento cair, eu te envio o acesso na hora.' },
  { field: 'offerMessage', bucket: 'objection_arc',
    guidance: 'Objeção = Reconhece → Responde curto e honesto → Volta pra ação. "Tá caro" → ofereça uma opção mais enxuta, NÃO desconto.',
    sampleTextAnon: 'Entendo! Se ajudar, tenho uma opção mais simples que cabe melhor — quer ver?' },
  { field: 'payPatterns', bucket: 'buy_signal',
    guidance: 'Inclua frases de SINAL DE COMPRA pra agir rápido (quanto custa, como pago, quero, fechar) — responda o sinal e já abra o próximo passo, sem empilhar argumentos.',
    sampleTextAnon: 'quanto custa, como pago, quero esse, pode fechar, fechado' },
  { field: 'general', bucket: 'act_dont_promise',
    guidance: 'Toda ação anunciada ("vou gerar o PIX") tem que acontecer no mesmo turno. Se falta um dado, PERGUNTE — não prometa o que não vai cumprir.',
    sampleTextAnon: 'Pra gerar o PIX certinho, só me confirma qual opção você quer?' },
  { field: 'general', bucket: 'mirror_tone',
    guidance: 'Espelhe tom, tamanho e emoji do cliente a cada mensagem (a persona é piso/teto, não voz fixa). NUNCA espelhe grosseria; mude de forma gradual.',
    sampleTextAnon: '(cliente curto → responda curto; cliente caloroso → responda caloroso)' },
]

export interface PatternForGen { field: string; bucket: string; guidance: string; sampleTextAnon: string | null; status: string }
export interface DistillCandidate { patternSetVersion: string; total: number; bots: number; conversions: number; convRate: number; wilsonLower: number; lift: number; passesKAnon: boolean }

export class PatternDistiller {
  constructor(private db: Pool) {}

  // Semeia o store com o playbook (idempotente). Roda no boot.
  async seed(): Promise<{ seeded: number }> {
    for (const p of PLAYBOOK_SEED) {
      await this.db.query(
        `INSERT INTO winning_patterns (field, bucket, guidance, sample_text_anon, vertical, source, status)
         VALUES ($1,$2,$3,$4,NULL,'playbook','seed')
         ON CONFLICT (field, bucket, COALESCE(vertical, '')) DO UPDATE SET
           guidance = EXCLUDED.guidance, sample_text_anon = EXCLUDED.sample_text_anon, updated_at = now()
         WHERE winning_patterns.source = 'playbook'`,
        [p.field, p.bucket, p.guidance, p.sampleTextAnon],
      )
    }
    return { seeded: PLAYBOOK_SEED.length }
  }

  // Destilação data-driven (offline). Agrupa conversas por pattern_set_version (carimbo do F3),
  // cruza com a conversão, aplica Wilson + k-anonymity. Hoje retorna [] (F3 ainda não carimba versões
  // e o volume é baixo) — o motor fica ARMADO; liga quando o volume cruzar o limiar. Honesto.
  async distill(windowDays = 90): Promise<{ candidates: DistillCandidate[]; baselineConvRate: number; note: string }> {
    const base = await this.db.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE outcome='paid')::int AS paid
       FROM conversation_outcomes WHERE created_at >= now() - ($1 || ' days')::interval`,
      [windowDays],
    )
    const baselineConvRate = base.rows[0].total > 0 ? base.rows[0].paid / base.rows[0].total : 0

    const { rows } = await this.db.query(
      `SELECT pattern_set_version AS v,
              count(*)::int AS total,
              count(DISTINCT bot_id)::int AS bots,
              count(*) FILTER (WHERE outcome='paid')::int AS paid
       FROM conversation_outcomes
       WHERE created_at >= now() - ($1 || ' days')::interval AND pattern_set_version IS NOT NULL
       GROUP BY pattern_set_version`,
      [windowDays],
    )
    const candidates: DistillCandidate[] = rows.map(r => {
      const convRate = r.total > 0 ? r.paid / r.total : 0
      return {
        patternSetVersion: r.v, total: r.total, bots: r.bots, conversions: r.paid, convRate,
        wilsonLower: wilsonLowerBound(r.paid, r.total),
        lift: baselineConvRate > 0 ? convRate / baselineConvRate : 0,
        passesKAnon: passesKAnonymity(r.total, r.bots),
      }
    }).filter(c => c.passesKAnon && c.wilsonLower > baselineConvRate)

    const note = candidates.length === 0
      ? 'Nenhum candidato: sem conversas com pattern_set_version suficiente (k-anon n≥20/≥2 bots). Motor armado; liga com volume + F3.'
      : `${candidates.length} versão(ões) vencedora(s) acima do baseline.`
    return { candidates, baselineConvRate, note }
  }

  // API que o F3 consome: padrões ATIVOS (seed + promoted) por campo, opcional por vertical.
  async getPatternsForGeneration(vertical?: string): Promise<Record<string, PatternForGen[]>> {
    const { rows } = await this.db.query(
      `SELECT field, bucket, guidance, sample_text_anon, status FROM winning_patterns
       WHERE status IN ('seed','promoted') AND (vertical IS NULL OR vertical = $1)
       ORDER BY field, (status='promoted') DESC`,
      [vertical ?? null],
    )
    const out: Record<string, PatternForGen[]> = {}
    for (const r of rows) {
      ;(out[r.field] ??= []).push({ field: r.field, bucket: r.bucket, guidance: r.guidance, sampleTextAnon: r.sample_text_anon, status: r.status })
    }
    return out
  }
}
