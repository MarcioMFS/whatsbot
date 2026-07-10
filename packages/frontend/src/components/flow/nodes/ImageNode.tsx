import { Image } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function ImageNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(236,72,153,0.12)" borderColor="border-pink-500/50"
      handles={{ inputs: [{}], outputs: [{}] }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-pink-500/30 flex items-center justify-center">
          <Image size={12} className="text-pink-400" />
        </div>
        <span className="text-xs font-semibold text-pink-400 uppercase tracking-wider">Imagem</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Enviar Imagem')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">{String(data.mediaUrl ?? '').split('/').pop()?.slice(0, 40) || 'sem URL'}</p>
    </BaseNode>
  )
}
