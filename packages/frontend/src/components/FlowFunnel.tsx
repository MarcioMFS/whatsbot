import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client.ts'

interface Stage { id: string; label: string; count: number }

const PERIODS = [7, 30, 90] as const

// Funil node-a-node do flow ativo: leads distintos que alcançaram cada marco.
export function FlowFunnel() {
  const { botId } = useParams<{ botId: string }>()
  const [days, setDays] = useState<number>(30)
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!botId) return
    setLoading(true)
    api.metrics.flowFunnel(botId, days)
      .then(d => { setStages(d.stages); setLoading(false) })
      .catch(() => setLoading(false))
  }, [botId, days])

  const max = Math.max(1, ...stages.map(s => s.count))
  const first = stages[0]?.count ?? 0

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Leads distintos que alcançaram cada etapa do funil ativo
        </p>
        <div className="flex gap-1">
          {PERIODS.map(d => (
            <button key={d} onClick={() => setDays(d)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ border: '1px solid var(--line)', background: days === d ? 'var(--ink)' : 'var(--paper-2)', color: days === d ? 'var(--paper)' : 'var(--muted)' }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm" style={{ color: 'var(--muted)' }}>Carregando…</p>}
      {!loading && stages.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Sem dados no período (o bot tem flow ativo?)</p>
      )}

      <div className="space-y-2.5">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1].count : null
          const drop = prev && prev > 0 ? Math.round((1 - s.count / prev) * 100) : null
          const pctOfFirst = first > 0 ? Math.round((s.count / first) * 100) : 0
          return (
            <div key={s.id}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{s.label}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--ink)' }}>{s.count}</strong>
                  {i > 0 && ` · ${pctOfFirst}% do topo`}
                  {drop !== null && drop > 0 && <span style={{ color: '#c2410c' }}> · −{drop}%</span>}
                </span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', height: 14 }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(2, (s.count / max) * 100)}%`, background: i === stages.length - 1 ? '#1d7a52' : 'var(--ink)' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
