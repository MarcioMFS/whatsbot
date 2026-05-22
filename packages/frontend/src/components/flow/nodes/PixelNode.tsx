import { BarChart2 } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function PixelNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(59,130,246,0.15)" borderColor="border-blue-400/60"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-blue-500/30 flex items-center justify-center">
          <BarChart2 size={12} className="text-blue-400" />
        </div>
        <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Pixel</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Facebook Pixel')}</p>
      <p className="text-xs text-slate-400 mt-0.5">{String(data.eventName ?? 'Purchase')}</p>
    </BaseNode>
  )
}
