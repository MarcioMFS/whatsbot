import { MessageSquare } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function TextNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(59,130,246,0.12)" borderColor="border-blue-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-blue-500/30 flex items-center justify-center">
          <MessageSquare size={12} className="text-blue-400" />
        </div>
        <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Text</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Send Message')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">{String(data.message ?? '').slice(0, 40)}</p>
    </BaseNode>
  )
}
