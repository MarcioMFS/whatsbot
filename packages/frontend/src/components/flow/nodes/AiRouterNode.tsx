import { Cpu } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

const ROUTER_OUTPUTS = [
  { id: 'ack',             label: 'Ack',           color: 'rgba(52,211,153,0.8)' },
  { id: 'title_search',    label: 'Busca título',  color: 'rgba(147,197,253,0.8)' },
  { id: 'catalog',         label: 'Catálogo',      color: 'rgba(99,179,237,0.8)' },
  { id: 'checkout',        label: 'Checkout',      color: 'rgba(251,191,36,0.8)' },
  { id: 'payment_receipt', label: 'Comprovante',   color: 'rgba(167,243,208,0.8)' },
  { id: 'doubt',           label: 'Dúvida',        color: 'rgba(196,181,253,0.8)' },
  { id: 'returning_user',  label: 'Voltou',        color: 'rgba(249,168,212,0.8)' },
  { id: 'price_issue',     label: 'Preço',         color: 'rgba(252,165,165,0.8)' },
  { id: 'negative_finish', label: 'Encerrar',      color: 'rgba(148,163,184,0.8)' },
  { id: 'handoff',         label: 'Suporte',       color: 'rgba(248,113,113,0.8)' },
  { id: 'continue',        label: 'Continuar',     color: 'rgba(94,234,212,0.8)' },
]

export function AiRouterNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  const allowedOutputs = Array.isArray(data.outputs)
    ? ROUTER_OUTPUTS.filter(o => (data.outputs as string[]).includes(o.id))
    : ROUTER_OUTPUTS

  return (
    <BaseNode selected={selected} color="rgba(139,92,246,0.12)" borderColor="border-violet-400/50"
      handles={{
        inputs: [{}],
        outputs: allowedOutputs,
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-violet-500/30 flex items-center justify-center">
          <Cpu size={12} className="text-violet-300" />
        </div>
        <span className="text-xs font-semibold text-violet-300 uppercase tracking-wider">AI Router</span>
      </div>
      <p className="text-sm text-white font-medium truncate max-w-[160px]">
        {String(data.label ?? 'Contextual Router')}
      </p>
      <p className="text-xs text-slate-400 mt-0.5">Claude · contexto completo</p>
    </BaseNode>
  )
}
