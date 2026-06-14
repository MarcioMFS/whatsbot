import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, Eyebrow } from '../components/mkhub'
import { api } from '../api/client'

interface IntentStat { intent: string; count: number; escalated: number }
interface Stats {
  total: number; aiCount: number; defaultCount: number; fallbackRate: number
  successCount: number; escalatedCount: number; pendingCount: number; byIntent: IntentStat[]
}
interface Observation {
  id: string; phoneNumber: string; userMessage: string; hasImage: boolean
  phase?: string; selectedIntent?: string; method: string; confidence?: number
  reasoning?: string; provider?: string; durationMs?: number; outcome?: string; createdAt: string
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export function AIPatterns() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<Stats | null>(null)
  const [problematic, setProblematic] = useState<Observation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!botId) return
    setLoading(true)
    Promise.all([
      api.observations.stats(botId, days).then(d => setStats(d.stats as Stats)).catch(() => setStats(null)),
      api.observations.problematic(botId, days).then(d => setProblematic((d.observations as Observation[]) ?? [])).catch(() => setProblematic([])),
    ]).finally(() => setLoading(false))
  }, [botId, days])

  const maxIntent = stats && stats.byIntent.length > 0 ? stats.byIntent[0].count : 1

  const outcomeColor = (o?: string) => o === 'success' ? '#1d7a52' : o === 'escalated' ? '#b42318' : 'var(--muted)'
  const dayPill = (active: boolean) => active
    ? { background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' }
    : { background: 'var(--paper-2)', color: 'var(--muted)', border: '1px solid var(--line)' }

  return (
    <MkLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/bots/${botId}/config`)} className="p-2 rounded-xl hover:opacity-60" style={{ color: 'var(--muted)' }}><ArrowLeft size={20} /></button>
            <div>
              <Eyebrow>Catálogo · IA</Eyebrow>
              <h1 className="mk-display" style={{ fontSize: '1.7rem', fontWeight: 700 }}>AI Patterns</h1>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>O que o roteador de IA decidiu — e como terminou</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {[7, 30].map(d => (
              <button key={d} onClick={() => setDays(d)} className="px-3 py-1.5 rounded-lg text-sm" style={dayPill(days === d)}>{d}d</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid var(--line)', borderTopColor: 'var(--ink)' }} />
          </div>
        ) : !stats || stats.total === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--muted)' }}>
            <TrendingUp size={40} strokeWidth={1.3} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p className="text-sm">Nenhuma decisão de IA registrada nos últimos {days} dias.</p>
            <p className="text-xs mt-1">As observações aparecem aqui conforme as conversas passam pelo nó ai_router.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Decisões', value: String(stats.total), color: 'var(--ink)', icon: TrendingUp },
                { label: 'Fallback (regra)', value: pct(stats.fallbackRate), color: stats.fallbackRate > 0.2 ? '#9a7400' : 'var(--ink)', icon: AlertTriangle },
                { label: 'Sucesso', value: String(stats.successCount), color: '#1d7a52', icon: CheckCircle2 },
                { label: 'Escalado', value: String(stats.escalatedCount), color: '#b42318', icon: XCircle },
                { label: 'Sem desfecho', value: String(stats.pendingCount), color: 'var(--muted)', icon: Clock },
              ].map(({ label, value, color, icon: Icon }) => (
                <MkCard key={label} style={{ padding: 16, textAlign: 'center' }}>
                  <Icon size={18} strokeWidth={1.6} style={{ color, margin: '0 auto 6px' }} />
                  <div className="mk-display" style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{value}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
                </MkCard>
              ))}
            </div>

            <MkCard style={{ padding: 20 }}>
              <h3 className="mk-display mb-4" style={{ fontWeight: 600 }}>Intenções detectadas</h3>
              <div className="space-y-2">
                {stats.byIntent.map(i => (
                  <div key={i.intent} className="flex items-center gap-3">
                    <span className="w-44 text-sm truncate" style={{ color: 'var(--ink-soft)' }}>{i.intent}</span>
                    <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--paper)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(i.count / maxIntent) * 100}%`, background: 'var(--ink)' }} />
                    </div>
                    <span className="w-10 text-right text-sm" style={{ color: 'var(--muted)' }}>{i.count}</span>
                    {i.escalated > 0 && <span className="text-xs whitespace-nowrap" style={{ color: '#9a7400' }}>⚠ {i.escalated}</span>}
                  </div>
                ))}
              </div>
            </MkCard>

            <div className="p-5 rounded-2xl" style={{ border: '1px solid rgba(217,163,0,0.3)', background: 'rgba(217,163,0,0.05)' }}>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={15} style={{ color: '#9a7400' }} />
                <h3 className="mk-display" style={{ fontWeight: 600 }}>Decisões problemáticas</h3>
                <Eyebrow style={{ fontSize: '.58rem', color: '#9a7400' }}>fallback ou baixa confiança</Eyebrow>
              </div>
              {problematic.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Nada problemático no período. 🎉</p>
              ) : (
                <div className="space-y-2">
                  {problematic.map(o => (
                    <div key={o.id} className="p-3 rounded-xl" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--paper)', border: `1px solid ${outcomeColor(o.outcome)}40`, color: outcomeColor(o.outcome) }}>{o.outcome ?? 'sem desfecho'}</span>
                        <span className="text-xs font-medium" style={{ color: 'var(--ink-soft)' }}>{o.selectedIntent ?? '—'}</span>
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>{o.method === 'default' ? 'regra' : o.method}</span>
                        {o.hasImage && <span className="text-xs">🖼</span>}
                        <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>{new Date(o.createdAt).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="text-sm mb-1.5" style={{ color: 'var(--ink-soft)' }}>"{o.userMessage}"</p>
                      <div className="flex gap-3 text-xs flex-wrap" style={{ color: 'var(--muted)' }}>
                        {o.phase && <span>fase: {o.phase}</span>}
                        {o.confidence != null && <span>conf: {pct(o.confidence)}</span>}
                        {o.durationMs != null && <span>{o.durationMs}ms</span>}
                        {o.provider && <span>{o.provider}</span>}
                        {o.reasoning && <span className="italic">{o.reasoning}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </MkLayout>
  )
}
