import { Clock } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function DelayNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(245,158,11,0.12)" borderColor="border-amber-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-amber-500/30 flex items-center justify-center">
          <Clock size={12} className="text-amber-400" />
        </div>
        <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Delay</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Wait')}</p>
      <p className="text-xs text-slate-400 mt-0.5">{String(data.seconds ?? 2)}s</p>
    </BaseNode>
  )
}
