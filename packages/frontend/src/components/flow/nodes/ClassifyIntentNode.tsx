import { Zap } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function ClassifyIntentNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(34,211,238,0.10)" borderColor="border-cyan-400/50"
      handles={{
        inputs: [{}],
        outputs: [
          { id: 'quantity',    label: 'Quantidade',   color: 'rgba(52,211,153,0.8)' },
          { id: 'ad_series',   label: 'Do anúncio',   color: 'rgba(167,243,208,0.8)' },
          { id: 'catalog',     label: 'Catálogo',     color: 'rgba(147,197,253,0.8)' },
          { id: 'pix_pending', label: 'Já pagou',     color: 'rgba(251,191,36,0.8)' },
          { id: 'price_issue', label: 'Preço/desc.',  color: 'rgba(252,165,165,0.8)' },
          { id: 'doubt',       label: 'Dúvida',       color: 'rgba(196,181,253,0.8)' },
          { id: 'unknown',     label: 'Desconhecido', color: 'rgba(148,163,184,0.8)' },
        ],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-cyan-400/20 flex items-center justify-center">
          <Zap size={12} className="text-cyan-300" />
        </div>
        <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Classify Intent</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Classificar Intenção')}</p>
      <p className="text-xs text-slate-400 mt-0.5">regras determinísticas → IA fallback</p>
    </BaseNode>
  )
}
