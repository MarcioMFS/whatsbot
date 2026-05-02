import { GitBranch } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function ConditionNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(245,158,11,0.12)" borderColor="border-amber-500/50"
      handles={{
        inputs: [{}],
        outputs: [
          { id: 'true', label: 'Yes', color: 'rgba(52,211,153,0.8)' },
          { id: 'false', label: 'No', color: 'rgba(248,113,113,0.8)' },
        ],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-amber-500/30 flex items-center justify-center">
          <GitBranch size={12} className="text-amber-400" />
        </div>
        <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Condition</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Condition')}</p>
      <p className="text-xs text-slate-400 mt-0.5">
        {String(data.variable ?? '?')} {String(data.operator ?? '=')} {String(data.value ?? '?')}
      </p>
      <div className="flex justify-between mt-2 text-xs">
        <span className="text-emerald-400">✓ true</span>
        <span className="text-red-400">✗ false</span>
      </div>
    </BaseNode>
  )
}
