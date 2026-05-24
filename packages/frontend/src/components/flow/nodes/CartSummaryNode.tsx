import { Receipt } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function CartSummaryNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(20,184,166,0.12)" borderColor="border-teal-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-teal-500/30 flex items-center justify-center">
          <Receipt size={12} className="text-teal-400" />
        </div>
        <span className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Resumo Carrinho</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Cart Summary')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">
        {data.messageTemplate ? 'template customizado' : 'template padrão'}
      </p>
    </BaseNode>
  )
}
