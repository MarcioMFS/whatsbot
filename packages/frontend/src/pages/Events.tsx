import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, Eyebrow } from '../components/mkhub'
import { api } from '../api/client'

interface ConversationEvent {
  botId: string; conversationId: string; phoneNumber: string
  eventType: string; payload: Record<string, unknown>; occurredAt: string
}

const EVENT_LABELS: Record<string, string> = {
  flow_started: 'Fluxo iniciado', flow_completed: 'Fluxo concluído',
  payment_requested: 'Pagamento solicitado', receipt_received: 'Comprovante recebido',
  receipt_validated: 'Comprovante validado', payment_approved: 'Pagamento aprovado',
  payment_rejected: 'Pagamento rejeitado', payment_expired: 'Pagamento expirado',
  conversation_suspended: 'Conversa suspensa', recovery_triggered: 'Recuperação ativada',
  tag_added: 'Tag adicionada', tag_removed: 'Tag removida',
  post_purchase_support_started: 'Suporte pós-compra',
}

// Editorial: sober semantic accents (green=ok, red=fail, amber=pending) — else neutral
function eventColor(type: string): string {
  if (/(approved|validated|completed)/.test(type)) return '#1d7a52'
  if (/(rejected|expired)/.test(type)) return '#b42318'
  if (/(requested|suspended|recovery)/.test(type)) return '#9a7400'
  return 'var(--ink-soft)'
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
    try { const { events: evts } = await api.bots.events(botId, 200); setEvents(evts as ConversationEvent[]) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [botId])

  const displayed = filter ? events.filter(e => e.eventType === filter) : events
  const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const pill = (active: boolean, color?: string) => active
    ? { background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' }
    : { background: 'var(--paper-2)', color: color ?? 'var(--muted)', border: '1px solid var(--line)' }

  return (
    <MkLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-7">
          <button onClick={() => navigate(-1)} className="hover:opacity-60" style={{ color: 'var(--muted)' }}><ArrowLeft size={18} /></button>
          <div className="flex-1">
            <Eyebrow>Eventos</Eyebrow>
            <h1 className="mk-display" style={{ fontSize: '1.7rem', fontWeight: 700 }}>Eventos da Conversa</h1>
            <p className="text-xs" style={{ color: 'var(--muted)', marginTop: 2 }}>{events.length} eventos recentes</p>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl disabled:opacity-50" style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button onClick={() => setFilter('')} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={pill(!filter)}>Todos</button>
          {FILTER_TYPES.map(type => (
            <button key={type} onClick={() => setFilter(f => f === type ? '' : type)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={pill(filter === type, eventColor(type))}>
              {EVENT_LABELS[type] ?? type}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-12 text-sm" style={{ color: 'var(--muted)' }}>Carregando...</div>}
        {!loading && displayed.length === 0 && (
          <MkCard style={{ padding: '48px 0', textAlign: 'center' }}><span className="text-sm" style={{ color: 'var(--muted)' }}>Nenhum evento encontrado.</span></MkCard>
        )}

        <div className="space-y-2">
          {displayed.map((evt, i) => {
            const key = `${evt.conversationId}-${i}`
            const isOpen = expanded === key
            return (
              <MkCard key={key} style={{ padding: 0, overflow: 'hidden' }}>
                <button onClick={() => setExpanded(isOpen ? null : key)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium shrink-0" style={{ background: 'var(--paper-2)', border: `1px solid ${eventColor(evt.eventType)}40`, color: eventColor(evt.eventType) }}>
                    {EVENT_LABELS[evt.eventType] ?? evt.eventType}
                  </span>
                  <span className="text-sm font-mono" style={{ color: 'var(--ink-soft)' }}>{evt.phoneNumber}</span>
                  <span className="text-xs ml-auto shrink-0" style={{ color: 'var(--muted)' }}>{fmt(evt.occurredAt)}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3" style={{ borderTop: '1px solid var(--line)' }}>
                    <pre className="text-xs mt-2 overflow-x-auto whitespace-pre-wrap font-mono rounded-lg p-3" style={{ color: 'var(--ink-soft)', background: 'var(--paper)' }}>
                      {JSON.stringify({ conversationId: evt.conversationId, ...evt.payload }, null, 2)}
                    </pre>
                  </div>
                )}
              </MkCard>
            )
          })}
        </div>
      </div>
    </MkLayout>
  )
}
