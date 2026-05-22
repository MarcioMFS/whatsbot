import { Bell } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function NotificationNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(234,179,8,0.12)" borderColor="border-yellow-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-yellow-500/30 flex items-center justify-center">
          <Bell size={12} className="text-yellow-400" />
        </div>
        <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">Notificação</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Notificação')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">{String(data.phoneNumber ?? '...')}</p>
    </BaseNode>
  )
}
