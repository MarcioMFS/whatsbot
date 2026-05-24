import { Search } from 'lucide-react'
import { BaseNode } from './BaseNode.tsx'

export function CatalogSearchNode({ selected, data }: { selected?: boolean; data: Record<string, unknown> }) {
  return (
    <BaseNode selected={selected} color="rgba(99,102,241,0.12)" borderColor="border-indigo-500/50"
      handles={{
        inputs: [{}],
        outputs: [
          { id: 'found', label: 'Encontrado', color: 'rgba(52,211,153,0.8)' },
          { id: 'not_found', label: 'Não encontrado', color: 'rgba(248,113,113,0.8)' },
        ],
      }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-lg bg-indigo-500/30 flex items-center justify-center">
          <Search size={12} className="text-indigo-400" />
        </div>
        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Buscar Produto</span>
      </div>
      <p className="text-sm text-white font-medium">{String(data.label ?? 'Catalog Search')}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">
        {data.searchFrom ? `var: ${data.searchFrom}` : 'da mensagem atual'}
      </p>
    </BaseNode>
  )
}
