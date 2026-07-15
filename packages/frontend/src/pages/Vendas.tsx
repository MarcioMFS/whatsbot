import { useSearchParams } from 'react-router-dom'
import { Package, ShoppingBag, Tag, CreditCard, BarChart3 } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { FlowFunnel } from '../components/FlowFunnel.tsx'
import { Products } from './Products.tsx'
import { Orders } from './Orders.tsx'
import { PackageOffers } from './PackageOffers.tsx'
import PaymentIntents from './PaymentIntents.tsx'

// Domínio comercial unificado (poda passo 3): Produtos/Pedidos/Ofertas/Pagamentos viram abas
// de UM item de sidebar, em vez de 4 rotas soltas. Re-hospeda as páginas existentes via `embedded`
// (sem reescrever a lógica). Ver Brain/spec_dashboard_poda.md.
const TABS = [
  { id: 'funil', label: 'Funil', icon: BarChart3 },
  { id: 'produtos', label: 'Produtos', icon: Package },
  { id: 'pedidos', label: 'Pedidos', icon: ShoppingBag },
  { id: 'ofertas', label: 'Ofertas', icon: Tag },
  { id: 'pagamentos', label: 'Pagamentos', icon: CreditCard },
] as const

export function Vendas() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') ?? 'produtos'
  const tab = TABS.some(t => t.id === raw) ? raw : 'produtos'

  return (
    <MkLayout>
      <div className="flex items-center gap-1.5 mb-6 flex-wrap">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setParams({ tab: t.id })}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{ border: '1px solid var(--line)', background: active ? 'var(--ink)' : 'var(--paper-2)', color: active ? 'var(--paper)' : 'var(--muted)' }}>
              <t.icon size={14} strokeWidth={1.7} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'funil' && <FlowFunnel />}
      {tab === 'produtos' && <Products embedded />}
      {tab === 'pedidos' && <Orders embedded />}
      {tab === 'ofertas' && <PackageOffers embedded />}
      {tab === 'pagamentos' && <PaymentIntents embedded />}
    </MkLayout>
  )
}
