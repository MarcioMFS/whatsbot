import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Layout } from '../components/ui/Layout'
import { api } from '../api/client'

interface ConversationEvent {
  botId: string
  conversationId: string
  phoneNumber: string
  eventType: string
  payload: Record<string, unknown>
  occurredAt: string
}

const EVENT_COLORS: Record<string, string> = {
  flow_started: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  flow_completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  payment_requested: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  receipt_received: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  receipt_validated: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  payment_approved: 'bg-green-500/20 text-green-300 border-green-500/30',
  payment_rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
  payment_expired: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  conversation_suspended: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  recovery_triggered: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  tag_added: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  tag_removed: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  post_purchase_support_started: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
}

const EVENT_LABELS: Record<string, string> = {
  flow_started: 'Fluxo iniciado',
  flow_completed: 'Fluxo concluído',
  payment_requested: 'Pagamento solicitado',
  receipt_received: 'Comprovante recebido',
  receipt_validated: 'Comprovante validado',
  payment_approved: 'Pagamento aprovado',
  payment_rejected: 'Pagamento rejeitado',
  payment_expired: 'Pagamento expirado',
  conversation_suspended: 'Conversa suspensa',
  recovery_triggered: 'Recuperação ativada',
  tag_added: 'Tag adicionada',
  tag_removed: 'Tag removida',
  post_purchase_support_started: 'Suporte pós-compra',
}

const FILTER_TYPES = [
  'payment_requested', 'receipt_received', 'receipt_validated',
  'payment_approved', 'payment_rejected', 'payment_expired',
  'conversation_suspended', 'flow_completed',
]

export function Events() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [events, setEvents] = useState<ConversationEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    if (!botId) return
    setLoading(true)
    try {
      const { events: evts } = await api.bots.events(botId, 200)
      setEvents(evts as ConversationEvent[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [botId])

  const displayed = filter ? events.filter(e => e.eventType === filter) : events

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Eventos da Conversa</h1>
            <p className="text-slate-400 text-xs mt-0.5">{events.length} eventos recentes</p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 bg-glass-200 hover:bg-glass-300 border border-glass-border text-slate-300 text-sm px-3 py-1.5 rounded-xl transition-all disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-5">
          <button
            onClick={() => setFilter('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${!filter ? 'bg-brand-500/30 border-brand-500/40 text-brand-300' : 'bg-glass-100 border-glass-border text-slate-400 hover:text-white'}`}
          >
            Todos
          </button>
          {FILTER_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setFilter(f => f === type ? '' : type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filter === type ? EVENT_COLORS[type] ?? 'bg-glass-200 border-glass-border text-white' : 'bg-glass-100 border-glass-border text-slate-400 hover:text-white'}`}
            >
              {EVENT_LABELS[type] ?? type}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center py-12 text-slate-500 text-sm">Carregando...</div>
        )}

        {!loading && displayed.length === 0 && (
          <div className="text-center py-12 text-slate-500 text-sm glass rounded-2xl">
            Nenhum evento encontrado.
          </div>
        )}

        <div className="space-y-2">
          {displayed.map((evt, i) => {
            const key = `${evt.conversationId}-${i}`
            const color = EVENT_COLORS[evt.eventType] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
            const isOpen = expanded === key
            return (
              <div key={key} className="glass border border-glass-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : key)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                >
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${color} shrink-0`}>
                    {EVENT_LABELS[evt.eventType] ?? evt.eventType}
                  </span>
                  <span className="text-slate-300 text-sm font-mono">{evt.phoneNumber}</span>
                  <span className="text-slate-500 text-xs ml-auto shrink-0">{fmt(evt.occurredAt)}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 border-t border-white/5">
                    <pre className="text-xs text-slate-400 mt-2 overflow-x-auto whitespace-pre-wrap font-mono bg-black/20 rounded-lg p-3">
                      {JSON.stringify({ conversationId: evt.conversationId, ...evt.payload }, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Layout>
  )
}
