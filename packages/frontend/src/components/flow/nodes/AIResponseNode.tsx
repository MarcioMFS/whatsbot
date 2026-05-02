import { Bot } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function AIResponseNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(168,85,247,0.12)" borderColor="border-purple-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-purple-500/30 flex items-center justify-center">
          <Bot size={12} className="text-purple-400" />
        </div>
        <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">AI Response</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'AI Response')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">{String(data.promptTemplate ?? '').slice(0, 40)}...</p>
    </BaseNode>
  )
}
