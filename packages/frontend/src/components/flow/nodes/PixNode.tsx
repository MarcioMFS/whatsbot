import { QrCode } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function PixNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(52,211,153,0.12)" borderColor="border-emerald-400/60"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-emerald-500/30 flex items-center justify-center">
          <QrCode size={12} className="text-emerald-400" />
        </div>
        <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Pix</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Botão Pix')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">{String(data.pixKey ?? 'chave@pix.com')}</p>
    </BaseNode>
  )
}
