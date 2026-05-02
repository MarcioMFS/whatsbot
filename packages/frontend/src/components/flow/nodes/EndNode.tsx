import { XCircle } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function EndNode({ selected }: { selected?: boolean; data?: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(239,68,68,0.12)" borderColor="border-red-500/50"
      handles={{ inputs: [{}] }}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-red-500/30 flex items-center justify-center">
          <XCircle size={12} className="text-red-400" />
        </div>
        <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">End</span>
      </div>
    </BaseNode>
  )
}
