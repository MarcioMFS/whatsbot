import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, CreditCard, XCircle, Clock, CheckCircle2, Ban } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, MkButton, Eyebrow } from '../components/mkhub'
import { api } from '../api/client'

interface PaymentIntent {
  id: string; botId: string; leadId: string; conversationId: string
  amount: number; receiverKey: string; receiverName: string
  status: 'pending' | 'paid' | 'expired' | 'cancelled'
  transactionId: string | null; attemptCount: number; expiresAt: string | null; createdAt: string
}

const STATUS_COLOR: Record<string, string> = { pending: '#9a7400', paid: '#1d7a52', expired: 'var(--muted)', cancelled: '#b42318' }
const STATUS_ICON: Record<string, React.ReactNode> = { pending: <Clock size={12} />, paid: <CheckCircle2 size={12} />, expired: <Ban size={12} />, cancelled: <XCircle size={12} /> }

const formatBRL = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'agora'; if (m < 60) return `${m}m atrás`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

export default function PaymentIntents() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [intents, setIntents] = useState<PaymentIntent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')
  const [cancelling, setCancelling] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try { setIntents(await api.paymentIntents.list(botId!, filter || undefined) as PaymentIntent[]) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [botId, filter])

  const cancel = async (id: string) => {
    if (!confirm('Cancelar este PaymentIntent?')) return
    setCancelling(id)
    try {
      await api.paymentIntents.cancel(id)
      setIntents(prev => prev.map(i => i.id === id ? { ...i, status: 'cancelled' } : i))
    } catch (e: unknown) { alert((e as Error).message ?? 'Erro ao cancelar') }
    finally { setCancelling(null) }
  }

  const stats = {
    pending: intents.filter(i => i.status === 'pending').length,
    paid: intents.filter(i => i.status === 'paid').length,
    expired: intents.filter(i => i.status === 'expired').length,
    cancelled: intents.filter(i => i.status === 'cancelled').length,
    totalPaid: intents.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0),
  }

  const filterPill = (active: boolean) => active
    ? { background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' }
    : { background: 'var(--paper-2)', color: 'var(--muted)', border: '1px solid var(--line)' }

  return (
    <MkLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/bots/${botId}`)} className="hover:opacity-60" style={{ color: 'var(--muted)' }}><ArrowLeft size={20} /></button>
            <CreditCard size={20} strokeWidth={1.7} />
            <div>
              <Eyebrow>Financeiro</Eyebrow>
              <h1 className="mk-display" style={{ fontSize: '1.5rem', fontWeight: 700 }}>PaymentIntents</h1>
            </div>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs disabled:opacity-50" style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Pendentes', value: stats.pending, c: '#9a7400' },
            { label: 'Pagos', value: stats.paid, c: '#1d7a52' },
            { label: 'Expirados', value: stats.expired, c: 'var(--muted)' },
            { label: 'Cancelados', value: stats.cancelled, c: '#b42318' },
            { label: 'Total pago', value: formatBRL(stats.totalPaid), c: 'var(--ink)' },
          ].map(s => (
            <MkCard key={s.label} style={{ padding: 14, textAlign: 'center' }}>
              <p className="mk-display" style={{ fontSize: '1.2rem', fontWeight: 700, color: s.c }}>{s.value}</p>
              <p className="text-xs" style={{ color: 'var(--muted)', marginTop: 2 }}>{s.label}</p>
            </MkCard>
          ))}
        </div>

        <div className="flex gap-2">
          {['', 'pending', 'paid', 'expired', 'cancelled'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className="px-3 py-1.5 rounded-xl text-xs font-medium" style={filterPill(filter === s)}>
              {s === '' ? 'Todos' : s}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {loading && <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>Carregando...</p>}
          {!loading && intents.length === 0 && <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>Nenhum PaymentIntent encontrado.</p>}
          {intents.map(intent => (
            <MkCard key={intent.id} style={{ padding: 16 }}>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium shrink-0" style={{ background: 'var(--paper-2)', border: `1px solid ${STATUS_COLOR[intent.status]}40`, color: STATUS_COLOR[intent.status] }}>
                  {STATUS_ICON[intent.status]} {intent.status}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>{formatBRL(intent.amount)}</span>
                    {intent.transactionId && <span className="text-xs font-mono truncate max-w-32" style={{ color: 'var(--muted)' }}>txn: {intent.transactionId}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs font-mono" style={{ color: 'var(--muted)' }}>{intent.id.slice(0, 8)}…</span>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>→ {intent.receiverName} ({intent.receiverKey})</span>
                    {intent.attemptCount > 0 && <span className="text-xs" style={{ color: '#9a7400' }}>{intent.attemptCount} tentativa(s)</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{timeAgo(intent.createdAt)}</p>
                  {intent.expiresAt && intent.status === 'pending' && <p className="text-xs mt-0.5" style={{ color: '#9a7400' }}>expira {timeAgo(intent.expiresAt)}</p>}
                </div>
                {intent.status === 'pending' && (
                  <button onClick={() => cancel(intent.id)} disabled={cancelling === intent.id}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs disabled:opacity-50"
                    style={{ background: 'rgba(180,35,24,0.08)', border: '1px solid rgba(180,35,24,0.2)', color: '#b42318' }}>
                    <XCircle size={12} /> {cancelling === intent.id ? '...' : 'Cancelar'}
                  </button>
                )}
              </div>
            </MkCard>
          ))}
        </div>
      </div>
    </MkLayout>
  )
}
