import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PhoneCall, Tag, MessageSquare, CheckCircle, Clock, XCircle, Filter } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, Eyebrow } from '../components/mkhub'
import { api } from '../api/client.ts'

type HandoffStatus = 'open' | 'in_progress' | 'resolved' | 'ignored'
type HandoffReason = 'unknown_intent' | 'price_issue' | 'doubt' | 'pix_failed' | 'series_not_found' | 'user_request' | 'escalated' | 'custom'

interface HandoffData {
  id: string; botId: string; conversationId: string; leadId: string | null; phoneNumber: string
  reason: HandoffReason; lastMessage: string; contextSummary: string | null
  leadTemperature: string; leadTags: string[]; status: HandoffStatus
  resolvedAt: string | null; resolvedBy: string | null; createdAt: string; updatedAt: string
}

const REASON_LABELS: Record<HandoffReason, string> = {
  unknown_intent: 'Intenção desconhecida', price_issue: 'Problema de preço', doubt: 'Dúvida',
  pix_failed: 'PIX falhou', series_not_found: 'Série não encontrada', user_request: 'Pedido do usuário',
  escalated: 'Escalado', custom: 'Personalizado',
}

const STATUS_CONFIG: Record<HandoffStatus, { label: string; color: string; icon: React.ReactNode }> = {
  open:        { label: 'Aberto',          color: '#b42318', icon: <Clock size={12} /> },
  in_progress: { label: 'Em atendimento',  color: '#9a7400', icon: <PhoneCall size={12} /> },
  resolved:    { label: 'Resolvido',       color: '#1d7a52', icon: <CheckCircle size={12} /> },
  ignored:     { label: 'Ignorado',        color: 'var(--muted)', icon: <XCircle size={12} /> },
}

const TEMP_COLORS: Record<string, string> = { hot: '#c2410c', warm: '#9a7400', cold: '#2563a8' }
const tempLabel = (t: string) => t === 'hot' ? '🔥 Quente' : t === 'warm' ? '🌤 Morno' : '❄️ Frio'

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'agora'; if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

const chip = (color: string) => ({ background: 'var(--paper-2)', border: `1px solid ${color}40`, color, padding: '2px 8px', borderRadius: 999, fontSize: '.72rem' })
const tagChip = { background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink-soft)', padding: '2px 8px', borderRadius: 999, fontSize: '.72rem' }

export function Handoffs() {
  const { botId } = useParams<{ botId: string }>()
  const [handoffs, setHandoffs] = useState<HandoffData[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<HandoffStatus | ''>('open')
  const [selected, setSelected] = useState<HandoffData | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    if (!botId) return
    api.handoffs.list(botId, statusFilter || undefined).then(data => {
      setHandoffs(data.handoffs as HandoffData[]); setTotal(data.total)
    })
  }, [botId, statusFilter])

  const updateStatus = async (id: string, status: HandoffStatus) => {
    if (updating) return
    setUpdating(true)
    try {
      const updated = await api.handoffs.updateStatus(id, status) as HandoffData
      setHandoffs(prev => prev.map(h => h.id === id ? updated : h))
      if (selected?.id === id) setSelected(updated)
    } finally { setUpdating(false) }
  }

  const openCount = handoffs.filter(h => h.status === 'open').length
  const filterPill = (active: boolean) => active
    ? { background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' }
    : { background: 'var(--paper-2)', color: 'var(--muted)', border: '1px solid var(--line)' }
  const box = { background: 'var(--paper)', borderRadius: 12, padding: 12 }

  const actionBtn = (color: string) => ({ background: `${color}14`, border: `1px solid ${color}33`, color, padding: '6px 12px', borderRadius: 8, fontSize: '.72rem', fontWeight: 600 })

  return (
    <MkLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow>Operação</Eyebrow>
            <h1 className="mk-display flex items-center gap-2" style={{ fontSize: '1.7rem', fontWeight: 700 }}>
              <PhoneCall size={24} strokeWidth={1.7} /> Handoffs
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{total} total{openCount > 0 && ` · ${openCount} abertos`}</p>
          </div>
          <div className="flex gap-2">
            {(['', 'open', 'in_progress', 'resolved', 'ignored'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={filterPill(statusFilter === s)}>
                <Filter size={10} /> {s === '' ? 'Todos' : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* List */}
          <div className="space-y-3">
            {handoffs.length === 0 && <MkCard style={{ padding: 24 }}><p className="text-center py-8" style={{ color: 'var(--muted)' }}>Nenhum handoff encontrado.</p></MkCard>}
            {handoffs.map(h => (
              <MkCard key={h.id} onClick={() => setSelected(h)} style={{ padding: 18, border: selected?.id === h.id ? '1px solid var(--ink)' : '1px solid var(--line)' }}>
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate" style={{ color: 'var(--ink)' }}>{h.phoneNumber}</span>
                      <span className="text-xs" style={{ color: TEMP_COLORS[h.leadTemperature] ?? 'var(--muted)' }}>{tempLabel(h.leadTemperature)}</span>
                    </div>
                    <span className="flex items-center gap-1 flex-shrink-0" style={chip(STATUS_CONFIG[h.status].color)}>
                      {STATUS_CONFIG[h.status].icon} {STATUS_CONFIG[h.status].label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={chip('var(--ink-soft)')}>{REASON_LABELS[h.reason]}</span>
                    {h.leadTags.map(tag => <span key={tag} style={tagChip}>{tag}</span>)}
                  </div>
                  <p className="text-xs line-clamp-2 flex items-start gap-1" style={{ color: 'var(--muted)' }}>
                    <MessageSquare size={10} className="mt-0.5 flex-shrink-0" /> {h.lastMessage}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{timeAgo(h.createdAt)}</p>
                </div>
              </MkCard>
            ))}
          </div>

          {/* Detail */}
          {selected && (
            <MkCard style={{ padding: 22 }}>
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="mk-display" style={{ fontWeight: 600, fontSize: '1.15rem' }}>{selected.phoneNumber}</h2>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{new Date(selected.createdAt).toLocaleString('pt-BR')}</p>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ color: 'var(--muted)' }} className="text-xl leading-none hover:opacity-60">×</button>
                </div>

                {selected.status !== 'resolved' && selected.status !== 'ignored' && (
                  <div className="flex gap-2 flex-wrap">
                    {selected.status === 'open' && (
                      <button onClick={() => updateStatus(selected.id, 'in_progress')} disabled={updating} className="flex items-center gap-1.5 disabled:opacity-50" style={actionBtn('#9a7400')}><PhoneCall size={12} /> Assumir atendimento</button>
                    )}
                    <button onClick={() => updateStatus(selected.id, 'resolved')} disabled={updating} className="flex items-center gap-1.5 disabled:opacity-50" style={actionBtn('#1d7a52')}><CheckCircle size={12} /> Marcar resolvido</button>
                    <button onClick={() => updateStatus(selected.id, 'ignored')} disabled={updating} className="flex items-center gap-1.5 disabled:opacity-50" style={actionBtn('#6b6b6b')}><XCircle size={12} /> Ignorar</button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div style={box}>
                    <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Motivo</p>
                    <span style={chip('var(--ink-soft)')}>{REASON_LABELS[selected.reason]}</span>
                  </div>
                  <div style={box}>
                    <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Temperatura</p>
                    <span className="text-sm font-medium" style={{ color: TEMP_COLORS[selected.leadTemperature] ?? 'var(--ink-soft)' }}>{tempLabel(selected.leadTemperature)}</span>
                  </div>
                </div>

                {selected.leadTags.length > 0 && (
                  <div style={box}>
                    <p className="text-xs mb-2 flex items-center gap-1" style={{ color: 'var(--muted)' }}><Tag size={10} /> Tags do lead</p>
                    <div className="flex flex-wrap gap-1.5">{selected.leadTags.map(tag => <span key={tag} style={tagChip}>{tag}</span>)}</div>
                  </div>
                )}

                <div style={box}>
                  <p className="text-xs mb-2 flex items-center gap-1" style={{ color: 'var(--muted)' }}><MessageSquare size={10} /> Última mensagem</p>
                  <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>{selected.lastMessage}</p>
                </div>

                {selected.contextSummary && (
                  <div style={box}>
                    <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>Resumo do contexto</p>
                    <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>{selected.contextSummary}</p>
                  </div>
                )}

                {selected.resolvedAt && (
                  <div style={{ background: 'rgba(34,160,107,0.06)', border: '1px solid rgba(34,160,107,0.2)', borderRadius: 12, padding: 12 }}>
                    <p className="text-xs" style={{ color: '#1d7a52' }}>
                      Resolvido em {new Date(selected.resolvedAt).toLocaleString('pt-BR')}{selected.resolvedBy && ` por ${selected.resolvedBy}`}
                    </p>
                  </div>
                )}
              </div>
            </MkCard>
          )}
        </div>
      </div>
    </MkLayout>
  )
}
