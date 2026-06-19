import { useEffect, useState } from 'react'
import { Sparkles, Trophy, Loader2, Inbox, AlertTriangle, ShieldCheck } from 'lucide-react'
import { Eyebrow, InfoTip, MkSwitch } from '../mkhub'
import { api, type FunnelResult, type WinningPattern, type VersionPerf } from '../../api/client.ts'

type AuditFlow = { flowId: string; flowName: string; patternSetVersion: string; patterns: Array<{ field: string; bucket: string; status: string }> }

// Painel evolutivo (read-only): onde o cliente cai (F1), padrões que convertem (F2), performance por versão (F4).
const STAGE_LABEL: Record<string, string> = { started: 'Iniciou', browsed: 'Buscou', cart: 'Carrinho', checkout: 'Checkout', paid: 'Pagou' }
const FIELD_LABEL: Record<string, string> = { introMessage: 'Abertura', askMessage: 'Engajamento', offerMessage: 'Oferta', payPatterns: 'Sinais de compra', general: 'Geral' }
const OUTCOME_META: Record<string, { label: string; bg: string; fg: string }> = {
  paid: { label: 'Pagou', bg: '#dcfce7', fg: '#166534' },
  abandoned: { label: 'Abandonou', bg: '#fef3c7', fg: '#92400e' },
  escalated: { label: 'Humano', bg: '#dbeafe', fg: '#1e40af' },
  timeout: { label: 'Sumiu', bg: '#f1f1f1', fg: '#6b7280' },
  completed: { label: 'Encerrou', bg: '#f1f1f1', fg: '#6b7280' },
}
const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  seed: { label: 'playbook', bg: '#eef2ff', fg: '#3730a3' },
  promoted: { label: 'promovido', bg: '#dcfce7', fg: '#166534' },
  candidate: { label: 'candidato', bg: '#fef3c7', fg: '#92400e' },
  retired: { label: 'aposentado', bg: '#f1f1f1', fg: '#9ca3af' },
}
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function MetricsPanel({ botId, optedOut, onToggleOptOut, savingOptOut }: {
  botId: string
  optedOut: boolean
  onToggleOptOut: (optOut: boolean) => void
  savingOptOut: boolean
}) {
  const [days, setDays] = useState(30)
  const [funnel, setFunnel] = useState<{ bot: FunnelResult; global: FunnelResult | null } | null>(null)
  const [patterns, setPatterns] = useState<Record<string, WinningPattern[]>>({})
  const [versions, setVersions] = useState<VersionPerf[]>([])
  const [audit, setAudit] = useState<AuditFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    Promise.all([api.metrics.funnel(botId, days), api.metrics.patterns(), api.metrics.performance(Math.max(days, 90)), api.metrics.audit(botId)])
      .then(([f, p, perf, a]) => { if (!alive) return; setFunnel({ bot: f.bot, global: f.global }); setPatterns(p.patterns); setVersions(perf.versions); setAudit(a.flows) })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : 'erro ao carregar') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [botId, days])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Eyebrow>Painel evolutivo</Eyebrow>
          <InfoTip text={<>Onde o cliente cai no funil, os padrões que mais convertem (que o gerador usa) e a performance por versão. Tudo <strong>read-only</strong> e atualiza sozinho.</>} />
        </div>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className="text-xs rounded-lg px-2.5 py-1 font-medium"
              style={{ border: '1px solid var(--line)', background: days === d ? 'var(--ink)' : 'var(--paper-2)', color: days === d ? 'var(--paper)' : 'var(--muted)' }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Governança — opt-out do aprendizado global (privacidade/LGPD) */}
      <div className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} style={{ color: optedOut ? 'var(--muted)' : '#22a06b', marginTop: 2 }} />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Aprendizado global {savingOptOut && <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>· salvando…</span>}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--muted)', maxWidth: 470 }}>
              {optedOut
                ? 'Desligado: as conversas deste bot NÃO alimentam o pool e o gerador usa só o playbook (sem padrões destilados de outros).'
                : 'Ligado: contribui com padrões anônimos (sem PII) e recebe os que mais convertem na plataforma.'}
            </div>
          </div>
        </div>
        <MkSwitch on={!optedOut} onChange={() => onToggleOptOut(!optedOut)} label={optedOut ? 'Fora' : 'Participando'} />
      </div>

      {err && <div className="rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)', color: '#b42318' }}>{err}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}><Loader2 size={14} className="animate-spin" /> carregando…</div>
      ) : (
        <>
          {funnel && <FunnelChart title="Seu funil" data={funnel.bot} />}
          {funnel?.global && <FunnelChart title="Global (anônimo · todos os bots)" data={funnel.global} subtle />}
          <PatternsSection patterns={patterns} />
          <PerformanceSection versions={versions} />
          <AuditSection flows={audit} />
        </>
      )}
    </div>
  )
}

function FunnelChart({ title, data, subtle }: { title: string; data: FunnelResult; subtle?: boolean }) {
  const max = Math.max(1, data.stages[0]?.count ?? 1)
  const drops = data.stages.filter(s => s.convFromPrev != null).sort((a, b) => (a.convFromPrev! - b.convFromPrev!))
  const worst = new Set(drops.slice(0, 2).filter(s => s.convFromPrev! < 1).map(s => s.stage))
  const noOutcomes = Object.values(data.outcomes).every(n => n === 0)

  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--line)', background: subtle ? 'var(--paper)' : 'var(--paper-2)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{title}</span>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>{data.conversations} conversas · {data.windowDays}d</span>
      </div>

      <div className="space-y-2">
        {data.stages.map(s => {
          const w = Math.max(3, (s.count / max) * 100)
          const isPaid = s.stage === 'paid'
          const leak = worst.has(s.stage)
          return (
            <div key={s.stage} className="flex items-center gap-3">
              <div className="text-xs w-20 shrink-0" style={{ color: 'var(--muted)' }}>{STAGE_LABEL[s.stage] ?? s.stage}</div>
              <div className="flex-1 h-6 rounded-md overflow-hidden" style={{ background: 'var(--line)' }}>
                <div className="h-full rounded-md flex items-center px-2" style={{ width: `${w}%`, minWidth: 30, background: isPaid ? '#22a06b' : subtle ? '#bcbcb8' : 'var(--ink)' }}>
                  <span className="text-xs font-medium" style={{ color: '#fff' }}>{s.count}</span>
                </div>
              </div>
              <div className="text-xs w-24 shrink-0 text-right" style={{ color: leak ? '#b45309' : 'var(--muted)' }}>
                {s.convFromPrev == null ? '—' : <>{leak && <AlertTriangle size={11} className="inline mr-0.5" style={{ verticalAlign: '-1px' }} />}{pct(s.convFromPrev)}</>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        {noOutcomes ? (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Desfechos por conversa começam a contar nas novas conversas.</span>
        ) : (
          Object.entries(data.outcomes).filter(([, n]) => n > 0).map(([k, n]) => {
            const m = OUTCOME_META[k] ?? { label: k, bg: '#f1f1f1', fg: '#6b7280' }
            return <span key={k} className="text-xs rounded-full px-2 py-0.5 font-medium" style={{ background: m.bg, color: m.fg }}>{m.label} {n}</span>
          })
        )}
        {data.gmvCentavos > 0 && <span className="text-xs ml-auto font-medium" style={{ color: 'var(--ink)' }}>GMV {brl(data.gmvCentavos)}</span>}
      </div>
    </div>
  )
}

function PatternsSection({ patterns }: { patterns: Record<string, WinningPattern[]> }) {
  const fields = Object.keys(patterns)
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} style={{ color: 'var(--muted)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Padrões que mais convertem</span>
        <InfoTip text={<>O que o gerador injeta ao criar funis. Começa com o playbook (<strong>seed</strong>) e <strong>promove/aposenta sozinho</strong> conforme as vendas validam.</>} />
      </div>
      {fields.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Sem padrões ainda.</div>
      ) : (
        <div className="space-y-3">
          {fields.map(field => (
            <div key={field}>
              <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>{FIELD_LABEL[field] ?? field}</div>
              <div className="space-y-1.5">
                {patterns[field].map(p => {
                  const st = STATUS_META[p.status] ?? { label: p.status, bg: '#f1f1f1', fg: '#6b7280' }
                  return (
                    <div key={p.id} className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{p.bucket}</span>
                        <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>{p.guidance}</div>
                      {p.sampleTextAnon && <div className="text-xs mt-0.5 italic" style={{ color: 'var(--muted)' }}>“{p.sampleTextAnon}”</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PerformanceSection({ versions }: { versions: VersionPerf[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={14} style={{ color: 'var(--muted)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Performance por versão</span>
        <InfoTip text={<>Conversão de cada conjunto de padrões usado pra gerar funis. Liga sozinha quando flows gerados acumularem tráfego.</>} />
      </div>
      {versions.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ border: '1px dashed var(--line)', color: 'var(--muted)' }}>
          <Inbox size={14} /> Ainda sem funis gerados com tráfego suficiente — a medição de lift liga sozinha com volume.
        </div>
      ) : (
        <div className="space-y-1.5">
          {versions.map(v => (
            <div key={v.patternSetVersion} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}>
              <span className="text-xs font-mono" style={{ color: 'var(--muted)' }}>{v.patternSetVersion}</span>
              <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{pct(v.convRate)}</span>
              <span className="text-xs ml-auto" style={{ color: 'var(--muted)' }}>{v.conversions}/{v.total} · {v.bots} bots · lift {v.lift.toFixed(2)}×</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AuditSection({ flows }: { flows: AuditFlow[] }) {
  if (flows.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={14} style={{ color: 'var(--muted)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Auditoria — o que gerou cada funil</span>
        <InfoTip text={<>Quais padrões alimentaram cada fluxo que a IA gerou. Rastreável por versão.</>} />
      </div>
      <div className="space-y-2">
        {flows.map(f => (
          <div key={f.flowId} className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--paper)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{f.flowName}</span>
              <span className="text-xs font-mono" style={{ color: 'var(--muted)' }}>{f.patternSetVersion}</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {f.patterns.length === 0
                ? <span className="text-xs" style={{ color: 'var(--muted)' }}>(sem padrões registrados)</span>
                : f.patterns.map((p, i) => <span key={i} className="text-xs rounded-full px-2 py-0.5" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>{p.bucket}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
