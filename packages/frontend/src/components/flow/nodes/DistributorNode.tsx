import { Shuffle } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function DistributorNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  const variations = (data.variations as string[] | undefined) ?? []

  return (
    <BaseNode selected={selected} color="rgba(249,115,22,0.12)" borderColor="border-orange-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-orange-500/30 flex items-center justify-center">
          <Shuffle size={12} className="text-orange-400" />
        </div>
        <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Distribuidor</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Distribuidor')}</p>
      <p className="text-xs text-slate-400 mt-0.5">{variations.length} variação{variations.length !== 1 ? 'ões' : ''}</p>
    </BaseNode>
  )
}
