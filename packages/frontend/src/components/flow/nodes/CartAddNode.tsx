import { ShoppingCart } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function CartAddNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(132,204,22,0.12)" borderColor="border-lime-500/50"
      handles={{
        inputs: [{}],
        outputs: [
          { id: 'success', label: 'Adicionado', color: 'rgba(52,211,153,0.8)' },
          { id: 'error', label: 'Erro', color: 'rgba(248,113,113,0.8)' },
        ],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-lime-500/30 flex items-center justify-center">
          <ShoppingCart size={12} className="text-lime-400" />
        </div>
        <span className="text-xs font-semibold text-lime-400 uppercase tracking-wider">Add Carrinho</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Cart Add')}</p>
      <p className="text-xs text-slate-400 mt-0.5">máx 20 itens · 10 KB</p>
    </BaseNode>
  )
}
