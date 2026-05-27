import { Zap } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

const HANDLE_COLORS: Record<string, string> = {
  greeting:        'rgba(52,211,153,0.8)',
  pay:             'rgba(251,191,36,0.8)',
  pix_pending:     'rgba(167,243,208,0.8)',
  catalog:         'rgba(147,197,253,0.8)',
  quantity:        'rgba(94,234,212,0.8)',
  price_issue:     'rgba(252,165,165,0.8)',
  doubt:           'rgba(196,181,253,0.8)',
  negative_finish: 'rgba(248,113,113,0.8)',
  ai_check:        'rgba(139,92,246,0.8)',
  unknown:         'rgba(148,163,184,0.8)',
  ad_series:       'rgba(167,243,208,0.8)',
}

const DEFAULT_COLOR = 'rgba(100,116,139,0.8)'

export function ClassifyIntentNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  const intents = (data.intents as Array<{ handle: string; isDefault?: boolean }> | undefined) ?? []

  // Non-default handles first, default (fallback) handle last
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const intent of intents) {
    if (!intent.isDefault && !seen.has(intent.handle)) {
      seen.add(intent.handle)
      ordered.push(intent.handle)
    }
  }
  for (const intent of intents) {
    if (intent.isDefault && !seen.has(intent.handle)) {
      seen.add(intent.handle)
      ordered.push(intent.handle)
    }
  }

  const outputs = ordered.length > 0
    ? ordered.map(h => ({ id: h, label: h, color: HANDLE_COLORS[h] ?? DEFAULT_COLOR }))
    : [{ id: 'unknown', label: 'Desconhecido', color: DEFAULT_COLOR }]

  return (
    <BaseNode selected={selected} color="rgba(34,211,238,0.10)" borderColor="border-cyan-400/50"
      handles={{ inputs: [{}], outputs }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-cyan-400/20 flex items-center justify-center">
          <Zap size={12} className="text-cyan-300" />
        </div>
        <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Classify Intent</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Classificar Intenção')}</p>
      <p className="text-xs text-slate-400 mt-0.5">
        {outputs.length} handle{outputs.length !== 1 ? 's' : ''} · IA fallback
      </p>
    </BaseNode>
  )
}
