import { CreditCard } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function CheckoutNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(245,158,11,0.12)" borderColor="border-amber-500/50"
      handles={{
        inputs: [{}],
        outputs: [
          { id: 'success', label: 'Pix enviado', color: 'rgba(52,211,153,0.8)' },
          { id: 'error', label: 'Erro', color: 'rgba(248,113,113,0.8)' },
        ],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-amber-500/30 flex items-center justify-center">
          <CreditCard size={12} className="text-amber-400" />
        </div>
        <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Checkout</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Checkout')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">
        {data.receiverKey ? `chave: ${data.receiverKey}` : 'usa config global'}
      </p>
    </BaseNode>
  )
}
