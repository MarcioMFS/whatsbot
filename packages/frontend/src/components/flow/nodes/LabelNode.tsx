import { Tag } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function LabelNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(167,139,250,0.12)" borderColor="border-violet-400/60"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-violet-500/30 flex items-center justify-center">
          <Tag size={12} className="text-violet-400" />
        </div>
        <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Etiqueta</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Etiqueta')}</p>
      <p className="text-xs text-slate-400 mt-0.5">🏷 {String(data.labelName ?? '...')}</p>
    </BaseNode>
  )
}
