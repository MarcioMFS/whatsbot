import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Layout } from '../components/ui/Layout'
import { api } from '../api/client'

// ─── Types (mirror backend AIObservationStats / AIObservation) ─────────────────

interface IntentStat {
  intent: string
  count: number
  escalated: number
}

interface Stats {
  total: number
  aiCount: number
  defaultCount: number
  fallbackRate: number
  successCount: number
  escalatedCount: number
  pendingCount: number
  byIntent: IntentStat[]
}

interface Observation {
  id: string
  phoneNumber: string
  userMessage: string
  hasImage: boolean
  phase?: string
  selectedIntent?: string
  method: string
  confidence?: number
  reasoning?: string
  provider?: string
  durationMs?: number
  outcome?: string
  createdAt: string
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

// ─── Page ──────────────────────────────────────────────────────────────────────

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
      api.observations.stats(botId, days)
        .then(d => setStats(d.stats as Stats))
        .catch(() => setStats(null)),
      api.observations.problematic(botId, days)
        .then(d => setProblematic((d.observations as Observation[]) ?? []))
        .catch(() => setProblematic([])),
    ]).finally(() => setLoading(false))
  }, [botId, days])

  const maxIntent = stats && stats.byIntent.length > 0 ? stats.byIntent[0].count : 1

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/bots/${botId}/config`)}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-all">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">AI Patterns</h1>
              <p className="text-sm text-white/40">O que o roteador de IA decidiu — e como terminou</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {[7, 30].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  days === d
                    ? 'bg-purple-500/25 border border-purple-500/50 text-white'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:text-white'
                }`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          </div>
        ) : !stats || stats.total === 0 ? (
          <div className="text-center py-16 text-white/30">
            <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhuma decisão de IA registrada nos últimos {days} dias.</p>
            <p className="text-xs mt-1">As observações aparecem aqui conforme as conversas passam pelo nó ai_router.</p>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Decisões', value: String(stats.total), color: 'text-blue-400', icon: TrendingUp },
                { label: 'Fallback (regra)', value: pct(stats.fallbackRate), color: stats.fallbackRate > 0.2 ? 'text-amber-400' : 'text-white', icon: AlertTriangle },
                { label: 'Sucesso', value: String(stats.successCount), color: 'text-green-400', icon: CheckCircle2 },
                { label: 'Escalado', value: String(stats.escalatedCount), color: 'text-red-400', icon: XCircle },
                { label: 'Sem desfecho', value: String(stats.pendingCount), color: 'text-white/60', icon: Clock },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className="p-4 rounded-2xl border border-white/10 bg-white/5 text-center">
                  <Icon className={`w-5 h-5 ${color} mx-auto mb-1`} />
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-white/40">{label}</div>
                </div>
              ))}
            </div>

            {/* Intent distribution */}
            <div className="p-5 rounded-2xl border border-white/10 bg-white/5">
              <h3 className="font-medium text-white mb-4">Intenções detectadas</h3>
              <div className="space-y-2">
                {stats.byIntent.map(i => (
                  <div key={i.intent} className="flex items-center gap-3">
                    <span className="w-44 text-sm text-white/70 truncate">{i.intent}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-purple-500/70 to-indigo-500/70"
                        style={{ width: `${(i.count / maxIntent) * 100}%` }} />
                    </div>
                    <span className="w-10 text-right text-sm text-white/60">{i.count}</span>
                    {i.escalated > 0 && (
                      <span className="text-xs text-amber-400 whitespace-nowrap">⚠ {i.escalated}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Problematic feed */}
            <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h3 className="font-medium text-white">Decisões problemáticas</h3>
                <span className="text-xs text-amber-400/70">fallback ou baixa confiança</span>
              </div>
              {problematic.length === 0 ? (
                <p className="text-sm text-white/40">Nada problemático no período. 🎉</p>
              ) : (
                <div className="space-y-2">
                  {problematic.map(o => (
                    <div key={o.id} className="p-3 rounded-xl bg-white/5 border border-white/5">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          o.outcome === 'success' ? 'bg-green-500/15 text-green-300 border-green-500/30' :
                          o.outcome === 'escalated' ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                          'bg-slate-500/15 text-slate-300 border-slate-500/30'
                        }`}>
                          {o.outcome ?? 'sem desfecho'}
                        </span>
                        <span className="text-xs font-medium text-white/80">{o.selectedIntent ?? '—'}</span>
                        <span className="text-xs text-white/40">{o.method === 'default' ? 'regra' : o.method}</span>
                        {o.hasImage && <span className="text-xs">🖼</span>}
                        <span className="ml-auto text-xs text-white/30">{new Date(o.createdAt).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="text-sm text-white/80 mb-1.5">"{o.userMessage}"</p>
                      <div className="flex gap-3 text-xs text-white/40 flex-wrap">
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
    </Layout>
  )
}
