import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, CreditCard, XCircle, Clock, CheckCircle2, Ban } from 'lucide-react'
import { Layout } from '../components/ui/Layout'
import { api } from '../api/client'

interface PaymentIntent {
  id: string
  botId: string
  leadId: string
  conversationId: string
  amount: number
  receiverKey: string
  receiverName: string
  status: 'pending' | 'paid' | 'expired' | 'cancelled'
  transactionId: string | null
  attemptCount: number
  expiresAt: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  paid: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  expired: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock size={12} />,
  paid: <CheckCircle2 size={12} />,
  expired: <Ban size={12} />,
  cancelled: <XCircle size={12} />,
}

function formatBRL(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}m atrás`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h atrás`
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
    try {
      const data = await api.paymentIntents.list(botId!, filter || undefined) as PaymentIntent[]
      setIntents(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [botId, filter])

  const cancel = async (id: string) => {
    if (!confirm('Cancelar este PaymentIntent?')) return
    setCancelling(id)
    try {
      await api.paymentIntents.cancel(id)
      setIntents(prev => prev.map(i => i.id === id ? { ...i, status: 'cancelled' } : i))
    } catch (e: unknown) {
      alert((e as Error).message ?? 'Erro ao cancelar')
    } finally {
      setCancelling(null)
    }
  }

  const stats = {
    pending: intents.filter(i => i.status === 'pending').length,
    paid: intents.filter(i => i.status === 'paid').length,
    expired: intents.filter(i => i.status === 'expired').length,
    cancelled: intents.filter(i => i.status === 'cancelled').length,
    totalPaid: intents.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0),
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/bots/${botId}`)} className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </button>
            <CreditCard size={20} className="text-brand-400" />
            <h1 className="text-xl font-bold text-white">PaymentIntents</h1>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-glass-100 border border-glass-border text-slate-300 hover:text-white text-xs transition-all">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Pendentes', value: stats.pending, cls: 'text-amber-300' },
            { label: 'Pagos', value: stats.paid, cls: 'text-emerald-300' },
            { label: 'Expirados', value: stats.expired, cls: 'text-slate-400' },
            { label: 'Cancelados', value: stats.cancelled, cls: 'text-red-400' },
            { label: 'Total pago', value: formatBRL(stats.totalPaid), cls: 'text-brand-300' },
          ].map(s => (
            <div key={s.label} className="glass border border-glass-border rounded-2xl p-3 text-center">
              <p className={`text-lg font-bold ${s.cls}`}>{s.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          {['', 'pending', 'paid', 'expired', 'cancelled'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${filter === s ? 'bg-brand-500/20 border-brand-500/40 text-brand-300' : 'bg-glass-100 border-glass-border text-slate-400 hover:text-white'}`}>
              {s === '' ? 'Todos' : s}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="space-y-2">
          {loading && <p className="text-slate-500 text-sm text-center py-8">Carregando...</p>}
          {!loading && intents.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">Nenhum PaymentIntent encontrado.</p>
          )}
          {intents.map(intent => (
            <div key={intent.id} className="glass border border-glass-border rounded-2xl p-4 flex items-center gap-4">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium ${STATUS_COLORS[intent.status]}`}>
                {STATUS_ICON[intent.status]}
                {intent.status}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">{formatBRL(intent.amount)}</span>
                  {intent.transactionId && (
                    <span className="text-xs text-slate-500 font-mono truncate max-w-32">txn: {intent.transactionId}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-slate-500 font-mono">{intent.id.slice(0, 8)}…</span>
                  <span className="text-xs text-slate-500">→ {intent.receiverName} ({intent.receiverKey})</span>
                  {intent.attemptCount > 0 && (
                    <span className="text-xs text-amber-500">{intent.attemptCount} tentativa(s)</span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className="text-xs text-slate-500">{timeAgo(intent.createdAt)}</p>
                {intent.expiresAt && intent.status === 'pending' && (
                  <p className="text-xs text-amber-500 mt-0.5">expira {timeAgo(intent.expiresAt)}</p>
                )}
              </div>

              {intent.status === 'pending' && (
                <button
                  onClick={() => cancel(intent.id)}
                  disabled={cancelling === intent.id}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs transition-all disabled:opacity-50"
                >
                  <XCircle size={12} />
                  {cancelling === intent.id ? '...' : 'Cancelar'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}
