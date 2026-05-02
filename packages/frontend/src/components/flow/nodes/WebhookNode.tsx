import { Globe } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function WebhookNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(6,182,212,0.12)" borderColor="border-cyan-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-cyan-500/30 flex items-center justify-center">
          <Globe size={12} className="text-cyan-400" />
        </div>
        <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Webhook</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'HTTP Request')}</p>
      <p className="text-xs text-slate-400 mt-0.5">
        <span className="text-cyan-400">{String(data.method ?? 'POST')}</span>{' '}
        {String(data.url ?? '').replace('https://', '').slice(0, 30)}
      </p>
    </BaseNode>
  )
}
