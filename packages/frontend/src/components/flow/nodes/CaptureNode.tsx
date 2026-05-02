import { Clipboard, Timer } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function CaptureNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  const hasTimeout = !!data.timeoutMinutes && Number(data.timeoutMinutes) > 0

  return (
    <BaseNode selected={selected} color="rgba(16,185,129,0.12)" borderColor="border-emerald-500/50"
      handles={{
        inputs: [{}],
        outputs: hasTimeout
          ? [
              { id: 'responded', label: 'Respondeu', color: 'bg-emerald-400' },
              { id: 'timeout', label: 'Sem resposta', color: 'bg-amber-400' },
            ]
          : [{ id: 'responded' }],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-emerald-500/30 flex items-center justify-center">
          <Clipboard size={12} className="text-emerald-400" />
        </div>
        <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Capture</span>
        {hasTimeout && (
          <div className="flex items-center gap-1 ml-auto">
            <Timer size={10} className="text-amber-400" />
            <span className="text-[10px] text-amber-400">{String(data.timeoutMinutes)}min</span>
          </div>
        )}
      </div>
      <p className="text-sm text-white font-medium truncate max-w-[160px]">{String(data.label ?? 'Capture Input')}</p>
      <p className="text-xs text-slate-400 mt-0.5">→ <span className="text-emerald-300">{'{'}{String(data.variableName ?? 'var')}{'}'}</span></p>
    </BaseNode>
  )
}
