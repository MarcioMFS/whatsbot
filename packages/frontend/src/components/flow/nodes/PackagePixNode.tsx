import { Package } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function PackagePixNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(251,146,60,0.12)" borderColor="border-orange-400/50"
      handles={{
        inputs: [{}],
        outputs: [
          { id: 'success', label: 'Pix enviado', color: 'rgba(52,211,153,0.8)' },
          { id: 'error', label: 'Erro / qty inválida', color: 'rgba(248,113,113,0.8)' },
        ],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-orange-400/25 flex items-center justify-center">
          <Package size={12} className="text-orange-300" />
        </div>
        <span className="text-xs font-semibold text-orange-300 uppercase tracking-wider">Package Pix</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Package Pix')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">
        qty: <span className="text-orange-300">{String(data.quantityVariable ?? '—')}</span>
        {data.unitPriceCentavos ? ` · R$${(Number(data.unitPriceCentavos) / 100).toFixed(2).replace('.', ',')} /item` : ''}
      </p>
    </BaseNode>
  )
}
