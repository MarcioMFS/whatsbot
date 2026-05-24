import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, ShoppingBag } from 'lucide-react'
import { Layout } from '../components/ui/Layout'
import { api } from '../api/client'

interface OrderItem {
  productId: string
  name: string
  priceCentavos: number
  accessLink?: string
}

interface Order {
  id: string
  botId: string
  leadId: string
  conversationId: string
  paymentIntentId: string
  items: OrderItem[]
  totalCentavos: number
  status: 'pending' | 'paid' | 'delivery_pending' | 'delivered' | 'cancelled'
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  paid: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  delivery_pending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  delivered: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  cancelled: 'bg-red-500/20 text-red-300 border-red-500/30',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  delivery_pending: 'Entrega pendente',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
}

function formatBRL(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function Orders() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  const load = async () => {
    if (!botId) return
    setLoading(true)
    try {
      const data = await api.orders.list(botId, 100)
      setOrders(data as Order[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [botId])

  const displayed = statusFilter ? orders.filter(o => o.status === statusFilter) : orders
  const totalRevenue = orders
    .filter(o => o.status === 'paid' || o.status === 'delivered')
    .reduce((s, o) => s + o.totalCentavos, 0)

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Pedidos</h1>
            <p className="text-slate-400 text-xs mt-0.5">{orders.length} pedidos · receita: {formatBRL(totalRevenue)}</p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 bg-glass-200 hover:bg-glass-300 border border-glass-border text-slate-300 text-sm px-3 py-1.5 rounded-xl transition-all disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {(['delivered', 'delivery_pending', 'paid', 'cancelled'] as const).map(s => {
            const count = orders.filter(o => o.status === s).length
            return (
              <button key={s} onClick={() => setStatusFilter(f => f === s ? '' : s)}
                className={`glass border rounded-xl p-3 text-left transition-all ${statusFilter === s ? 'border-brand-500/40' : 'border-glass-border hover:border-slate-600'}`}>
                <p className="text-2xl font-bold text-white">{count}</p>
                <p className={`text-xs mt-0.5 ${STATUS_COLORS[s].split(' ')[1]}`}>{STATUS_LABELS[s]}</p>
              </button>
            )
          })}
        </div>

        {loading && <div className="text-center py-8 text-slate-500 text-sm">Carregando...</div>}

        {!loading && displayed.length === 0 && (
          <div className="glass border border-glass-border rounded-xl py-12 text-center">
            <ShoppingBag size={28} className="text-slate-500 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Nenhum pedido encontrado.</p>
          </div>
        )}

        <div className="space-y-2">
          {displayed.map(order => {
            const isOpen = expanded === order.id
            const color = STATUS_COLORS[order.status] ?? STATUS_COLORS.pending
            return (
              <div key={order.id} className="glass border border-glass-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : order.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                >
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${color} shrink-0`}>
                    {STATUS_LABELS[order.status]}
                  </span>
                  <span className="text-slate-300 text-sm font-mono truncate flex-1">{order.id.slice(0, 8)}…</span>
                  <span className="text-brand-400 text-sm font-semibold shrink-0">{formatBRL(order.totalCentavos)}</span>
                  <span className="text-slate-500 text-xs shrink-0">{fmt(order.createdAt)}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-white/5 space-y-2 pt-3">
                    <p className="text-slate-500 text-xs font-mono">conv: {order.conversationId}</p>
                    {order.items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-sm text-white">{item.name}</p>
                          {item.accessLink
                            ? <a href={item.accessLink} target="_blank" rel="noreferrer" className="text-brand-400 text-xs hover:underline">{item.accessLink}</a>
                            : <span className="text-amber-400 text-xs">⚠ sem link de acesso</span>
                          }
                        </div>
                        <span className="text-slate-400 text-sm">{formatBRL(item.priceCentavos)}</span>
                      </div>
                    ))}
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
