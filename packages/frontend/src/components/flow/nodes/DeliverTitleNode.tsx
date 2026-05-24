import { Send } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function DeliverTitleNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(52,211,153,0.10)" borderColor="border-emerald-400/50"
      handles={{
        inputs: [{}],
        outputs: [
          { id: 'done',    label: 'Tudo entregue',   color: 'rgba(52,211,153,0.9)' },
          { id: 'more',    label: 'Ainda tem slots',  color: 'rgba(147,197,253,0.8)' },
          { id: 'partial', label: 'Parcial (sem link)', color: 'rgba(251,191,36,0.8)' },
          { id: 'error',   label: 'Erro',             color: 'rgba(248,113,113,0.8)' },
        ],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-emerald-400/20 flex items-center justify-center">
          <Send size={12} className="text-emerald-300" />
        </div>
        <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Deliver Title</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Entregar Título')}</p>
      <p className="text-xs text-slate-400 mt-0.5">
        slots: <span className="text-emerald-300">__rt_remaining_slots</span>
        {data.notifyOwnerOnMissingLink !== false ? ' · notifica owner' : ''}
      </p>
    </BaseNode>
  )
}
