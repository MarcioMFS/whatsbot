import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, ShoppingBag } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, Eyebrow } from '../components/mkhub'
import { api } from '../api/client'

interface OrderItem { productId: string; name: string; priceCentavos: number; accessLink?: string }

interface Order {
  id: string; botId: string; leadId: string; conversationId: string; paymentIntentId: string
  items: OrderItem[]; totalCentavos: number
  status: 'pending' | 'paid' | 'delivery_pending' | 'delivered' | 'cancelled'
  createdAt: string
}

const STATUS: Record<string, { label: string; color: string }> = {
  pending:          { label: 'Pendente',         color: 'var(--muted)' },
  paid:             { label: 'Pago',             color: '#2563a8' },
  delivery_pending: { label: 'Entrega pendente', color: '#9a7400' },
  delivered:        { label: 'Entregue',         color: '#1d7a52' },
  cancelled:        { label: 'Cancelado',        color: '#b42318' },
}

function statusPill(status: string) {
  const c = STATUS[status] ?? STATUS.pending
  return { background: 'var(--paper-2)', border: `1px solid ${c.color}40`, color: c.color, padding: '3px 10px', borderRadius: 8, fontSize: '.72rem', fontWeight: 600 }
}

const formatBRL = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function Orders({ embedded = false }: { embedded?: boolean } = {}) {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  const load = async () => {
    if (!botId) return
    setLoading(true)
    try { setOrders(await api.orders.list(botId, 100) as Order[]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [botId])

  const displayed = statusFilter ? orders.filter(o => o.status === statusFilter) : orders
  const totalRevenue = orders.filter(o => o.status === 'paid' || o.status === 'delivered').reduce((s, o) => s + o.totalCentavos, 0)

  const body = (
    <>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-7">
          <button onClick={() => navigate(-1)} className="hover:opacity-60" style={{ color: 'var(--muted)' }}><ArrowLeft size={18} /></button>
          <div className="flex-1">
            <Eyebrow>Pedidos</Eyebrow>
            <h1 className="mk-display" style={{ fontSize: '1.7rem', fontWeight: 700 }}>Pedidos</h1>
            <p className="text-xs" style={{ color: 'var(--muted)', marginTop: 2 }}>{orders.length} pedidos · receita: {formatBRL(totalRevenue)}</p>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl disabled:opacity-50" style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {(['delivered', 'delivery_pending', 'paid', 'cancelled'] as const).map(s => {
            const count = orders.filter(o => o.status === s).length
            return (
              <button key={s} onClick={() => setStatusFilter(f => f === s ? '' : s)}>
                <MkCard style={{ padding: 14, textAlign: 'left', border: statusFilter === s ? '1px solid var(--ink)' : '1px solid var(--line)' }}>
                  <p className="mk-display" style={{ fontSize: '1.6rem', fontWeight: 700 }}>{count}</p>
                  <p className="text-xs" style={{ color: STATUS[s].color, marginTop: 2 }}>{STATUS[s].label}</p>
                </MkCard>
              </button>
            )
          })}
        </div>

        {loading && <div className="text-center py-8 text-sm" style={{ color: 'var(--muted)' }}>Carregando...</div>}

        {!loading && displayed.length === 0 && (
          <MkCard style={{ padding: '48px 0', textAlign: 'center' }}>
            <ShoppingBag size={28} strokeWidth={1.4} style={{ margin: '0 auto 12px', color: 'var(--muted)' }} />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Nenhum pedido encontrado.</p>
          </MkCard>
        )}

        <div className="space-y-2">
          {displayed.map(order => {
            const isOpen = expanded === order.id
            return (
              <MkCard key={order.id} style={{ padding: 0, overflow: 'hidden' }}>
                <button onClick={() => setExpanded(isOpen ? null : order.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span style={statusPill(order.status)} className="shrink-0">{(STATUS[order.status] ?? STATUS.pending).label}</span>
                  <span className="text-sm font-mono truncate flex-1" style={{ color: 'var(--ink-soft)' }}>{order.id.slice(0, 8)}…</span>
                  <span className="text-sm font-semibold shrink-0" style={{ color: 'var(--ink)' }}>{formatBRL(order.totalCentavos)}</span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{fmt(order.createdAt)}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-2 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                    <p className="text-xs font-mono" style={{ color: 'var(--muted)' }}>conv: {order.conversationId}</p>
                    {order.items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--paper)' }}>
                        <div>
                          <p className="text-sm" style={{ color: 'var(--ink)' }}>{item.name}</p>
                          {item.accessLink
                            ? <a href={item.accessLink} target="_blank" rel="noreferrer" className="text-xs mk-link" style={{ color: 'var(--ink)' }}>{item.accessLink}</a>
                            : <span className="text-xs" style={{ color: '#9a7400' }}>⚠ sem link de acesso</span>}
                        </div>
                        <span className="text-sm" style={{ color: 'var(--muted)' }}>{formatBRL(item.priceCentavos)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </MkCard>
            )
          })}
        </div>
      </div>
    </>
  )
  return embedded ? body : <MkLayout>{body}</MkLayout>
}
