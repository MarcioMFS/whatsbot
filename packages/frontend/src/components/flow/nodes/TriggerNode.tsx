import { Zap } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function TriggerNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(14,165,233,0.15)" borderColor="border-brand-500/50"
      handles={{ outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-brand-500/30 flex items-center justify-center">
          <Zap size={12} className="text-brand-400" />
        </div>
        <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Trigger</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Start')}</p>
      <p className="text-xs text-slate-400 mt-0.5 capitalize">{String(data.triggerType ?? 'any_message').replace('_', ' ')}</p>
    </BaseNode>
  )
}
