import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PhoneCall, Thermometer, Tag, MessageSquare, CheckCircle, Clock, XCircle, Filter } from 'lucide-react'
import { Layout } from '../components/ui/Layout.tsx'
import { GlassCard } from '../components/ui/GlassCard.tsx'
import { api } from '../api/client.ts'

type HandoffStatus = 'open' | 'in_progress' | 'resolved' | 'ignored'
type HandoffReason = 'unknown_intent' | 'price_issue' | 'doubt' | 'pix_failed' | 'series_not_found' | 'user_request' | 'escalated' | 'custom'

interface HandoffData {
  id: string
  botId: string
  conversationId: string
  leadId: string | null
  phoneNumber: string
  reason: HandoffReason
  lastMessage: string
  contextSummary: string | null
  leadTemperature: string
  leadTags: string[]
  status: HandoffStatus
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
}

const REASON_LABELS: Record<HandoffReason, string> = {
  unknown_intent: 'Intenção desconhecida',
  price_issue: 'Problema de preço',
  doubt: 'Dúvida',
  pix_failed: 'PIX falhou',
  series_not_found: 'Série não encontrada',
  user_request: 'Pedido do usuário',
  escalated: 'Escalado',
  custom: 'Personalizado',
}

const REASON_COLORS: Record<HandoffReason, string> = {
  unknown_intent: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  price_issue: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  doubt: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  pix_failed: 'bg-red-500/20 text-red-300 border-red-500/30',
  series_not_found: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  user_request: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  escalated: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  custom: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
}

const STATUS_CONFIG: Record<HandoffStatus, { label: string; color: string; icon: React.ReactNode }> = {
  open: {
    label: 'Aberto',
    color: 'bg-red-500/20 text-red-300 border-red-500/30',
    icon: <Clock size={12} />,
  },
  in_progress: {
    label: 'Em atendimento',
    color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    icon: <PhoneCall size={12} />,
  },
  resolved: {
    label: 'Resolvido',
    color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    icon: <CheckCircle size={12} />,
  },
  ignored: {
    label: 'Ignorado',
    color: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    icon: <XCircle size={12} />,
  },
}

const TEMP_COLORS: Record<string, string> = {
  hot: 'text-red-400',
  warm: 'text-orange-400',
  cold: 'text-blue-400',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

function tempLabel(t: string) {
  return t === 'hot' ? '🔥 Quente' : t === 'warm' ? '🌤 Morno' : '❄️ Frio'
}

export function Handoffs() {
  const { botId } = useParams<{ botId: string }>()
  const [handoffs, setHandoffs] = useState<HandoffData[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<HandoffStatus | ''>('open')
  const [selected, setSelected] = useState<HandoffData | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    if (!botId) return
    const params = new URLSearchParams({ limit: '50' })
    if (statusFilter) params.set('status', statusFilter)
    api.handoffs.list(botId, statusFilter || undefined).then(data => {
      setHandoffs(data.handoffs as HandoffData[])
      setTotal(data.total)
    })
  }, [botId, statusFilter])

  const updateStatus = async (id: string, status: HandoffStatus) => {
    if (updating) return
    setUpdating(true)
    try {
      const updated = await api.handoffs.updateStatus(id, status) as HandoffData
      setHandoffs(prev => prev.map(h => h.id === id ? updated : h))
      if (selected?.id === id) setSelected(updated)
    } finally {
      setUpdating(false)
    }
  }

  const openCount = handoffs.filter(h => h.status === 'open').length

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <PhoneCall className="text-brand-400" size={24} />
              Handoffs
            </h1>
            <p className="text-white/50 text-sm mt-1">
              {total} total{openCount > 0 && ` · ${openCount} abertos`}
            </p>
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            {(['', 'open', 'in_progress', 'resolved', 'ignored'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  statusFilter === s
                    ? 'bg-brand-500/30 text-brand-300 border-brand-500/40'
                    : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
                }`}
              >
                <Filter size={10} />
                {s === '' ? 'Todos' : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* List */}
          <div className="space-y-3">
            {handoffs.length === 0 && (
              <GlassCard>
                <p className="text-white/40 text-center py-8">Nenhum handoff encontrado.</p>
              </GlassCard>
            )}
            {handoffs.map(h => (
              <GlassCard
                key={h.id}
                className={`cursor-pointer transition-all hover:bg-white/10 ${selected?.id === h.id ? 'ring-1 ring-brand-500/50' : ''}`}
                onClick={() => setSelected(h)}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white font-medium text-sm truncate">{h.phoneNumber}</span>
                      <span className={`text-xs ${TEMP_COLORS[h.leadTemperature] ?? 'text-white/40'}`}>
                        {tempLabel(h.leadTemperature)}
                      </span>
                    </div>
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border flex-shrink-0 ${STATUS_CONFIG[h.status].color}`}>
                      {STATUS_CONFIG[h.status].icon}
                      {STATUS_CONFIG[h.status].label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${REASON_COLORS[h.reason]}`}>
                      {REASON_LABELS[h.reason]}
                    </span>
                    {h.leadTags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-brand-500/10 text-brand-300 border border-brand-500/20">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <p className="text-white/60 text-xs line-clamp-2 flex items-start gap-1">
                    <MessageSquare size={10} className="mt-0.5 flex-shrink-0 text-white/30" />
                    {h.lastMessage}
                  </p>

                  <p className="text-white/30 text-xs">{timeAgo(h.createdAt)}</p>
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="space-y-4">
              <GlassCard>
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-white font-semibold text-lg">{selected.phoneNumber}</h2>
                      <p className="text-white/40 text-xs">{new Date(selected.createdAt).toLocaleString('pt-BR')}</p>
                    </div>
                    <button
                      onClick={() => setSelected(null)}
                      className="text-white/30 hover:text-white/60 text-xl leading-none"
                    >
                      ×
                    </button>
                  </div>

                  {/* Status actions */}
                  {selected.status !== 'resolved' && selected.status !== 'ignored' && (
                    <div className="flex gap-2 flex-wrap">
                      {selected.status === 'open' && (
                        <button
                          onClick={() => updateStatus(selected.id, 'in_progress')}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50"
                        >
                          <PhoneCall size={12} />
                          Assumir atendimento
                        </button>
                      )}
                      <button
                        onClick={() => updateStatus(selected.id, 'resolved')}
                        disabled={updating}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        <CheckCircle size={12} />
                        Marcar resolvido
                      </button>
                      <button
                        onClick={() => updateStatus(selected.id, 'ignored')}
                        disabled={updating}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-500/20 text-slate-300 border border-slate-500/30 hover:bg-slate-500/30 disabled:opacity-50"
                      >
                        <XCircle size={12} />
                        Ignorar
                      </button>
                    </div>
                  )}

                  {/* Reason + Temperature */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40 text-xs mb-1">Motivo</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${REASON_COLORS[selected.reason]}`}>
                        {REASON_LABELS[selected.reason]}
                      </span>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40 text-xs mb-1">Temperatura</p>
                      <span className={`text-sm font-medium ${TEMP_COLORS[selected.leadTemperature] ?? 'text-white/60'}`}>
                        {tempLabel(selected.leadTemperature)}
                      </span>
                    </div>
                  </div>

                  {/* Tags */}
                  {selected.leadTags.length > 0 && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40 text-xs mb-2 flex items-center gap-1">
                        <Tag size={10} />
                        Tags do lead
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.leadTags.map(tag => (
                          <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-brand-500/10 text-brand-300 border border-brand-500/20">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Last message */}
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-white/40 text-xs mb-2 flex items-center gap-1">
                      <MessageSquare size={10} />
                      Última mensagem
                    </p>
                    <p className="text-white/80 text-sm">{selected.lastMessage}</p>
                  </div>

                  {/* Context summary */}
                  {selected.contextSummary && (
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-white/40 text-xs mb-2">Resumo do contexto</p>
                      <p className="text-white/70 text-sm">{selected.contextSummary}</p>
                    </div>
                  )}

                  {/* Resolution info */}
                  {selected.resolvedAt && (
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                      <p className="text-emerald-400 text-xs">
                        Resolvido em {new Date(selected.resolvedAt).toLocaleString('pt-BR')}
                        {selected.resolvedBy && ` por ${selected.resolvedBy}`}
                      </p>
                    </div>
                  )}
                </div>
              </GlassCard>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
