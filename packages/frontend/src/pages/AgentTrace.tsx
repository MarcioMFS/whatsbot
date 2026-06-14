import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Wrench, MessageSquare, AlertTriangle, Zap } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, Eyebrow, InfoTip } from '../components/mkhub'
import { api, type AgentTraceEntry } from '../api/client.ts'

const KIND_LABEL: Record<AgentTraceEntry['kind'], string> = {
  tool: 'Ferramenta', reply: 'Resposta', nudge: 'Cutucão', error: 'Erro',
}
const KIND_ICON = { tool: Wrench, reply: MessageSquare, nudge: Zap, error: AlertTriangle }

function kindColor(e: AgentTraceEntry): string {
  if (e.kind === 'error') return '#b42318'
  if (e.kind === 'nudge') return '#9a7400'
  if (e.kind === 'tool') return e.resultSuccess === false ? '#b42318' : '#1d7a52'
  return 'var(--ink-soft)'
}

const FILTERS: AgentTraceEntry['kind'][] = ['tool', 'reply', 'nudge', 'error']

export function AgentTrace() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [trace, setTrace] = useState<AgentTraceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    if (!botId) return
    setLoading(true)
    try { const { trace: t } = await api.bots.agentTrace(botId, 200); setTrace(t) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [botId])

  const displayed = filter ? trace.filter(t => t.kind === filter) : trace
  const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const pill = (active: boolean, color?: string) => active
    ? { background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' }
    : { background: 'var(--paper-2)', color: color ?? 'var(--muted)', border: '1px solid var(--line)' }

  return (
    <MkLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-7">
          <button onClick={() => navigate(-1)} className="hover:opacity-60" style={{ color: 'var(--muted)' }}><ArrowLeft size={18} /></button>
          <div className="flex-1">
            <div className="flex items-center gap-2"><Eyebrow>Agente</Eyebrow><InfoTip text={<>Trilha do que a IA fez: cada <strong>ferramenta</strong> chamada (com os argumentos e o resultado), cada <strong>resposta</strong>, <strong>cutucão</strong> (quando ela prometeu e não agiu) e <strong>erro</strong>. É a prova de "quem foi chamado, como, e o que voltou".</>} /></div>
            <h1 className="mk-display" style={{ fontSize: '1.7rem', fontWeight: 700 }}>Trilha do Agente</h1>
            <p className="text-xs" style={{ color: 'var(--muted)', marginTop: 2 }}>{trace.length} passos recentes</p>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl disabled:opacity-50" style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button onClick={() => setFilter('')} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={pill(!filter)}>Todos</button>
          {FILTERS.map(k => (
            <button key={k} onClick={() => setFilter(f => f === k ? '' : k)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={pill(filter === k, kindColor({ kind: k } as AgentTraceEntry))}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-12 text-sm" style={{ color: 'var(--muted)' }}>Carregando...</div>}
        {!loading && displayed.length === 0 && (
          <MkCard style={{ padding: '48px 0', textAlign: 'center' }}><span className="text-sm" style={{ color: 'var(--muted)' }}>Nenhum passo do agente ainda. (Só registra quando o bot roda em modo Agente / número de teste.)</span></MkCard>
        )}

        <div className="space-y-2">
          {displayed.map((t, i) => {
            const key = `${t.conversationId}-${i}`
            const isOpen = expanded === key
            const color = kindColor(t)
            const Icon = KIND_ICON[t.kind]
            const headline = t.kind === 'tool'
              ? `${t.toolName ?? 'tool'} → ${t.resultCode ?? '?'}`
              : t.kind === 'reply' ? (t.text ?? '').slice(0, 70)
              : t.kind === 'nudge' ? 'promessa sem ação → cutucado'
              : (t.text ?? 'erro')
            return (
              <MkCard key={key} style={{ padding: 0, overflow: 'hidden' }}>
                <button onClick={() => setExpanded(isOpen ? null : key)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium shrink-0" style={{ background: 'var(--paper-2)', border: `1px solid ${color}40`, color }}>
                    <Icon size={12} /> {KIND_LABEL[t.kind]}
                  </span>
                  <span className="text-sm truncate" style={{ color: 'var(--ink-soft)' }}>{headline}</span>
                  <span className="text-xs font-mono shrink-0" style={{ color: 'var(--muted)' }}>{t.phoneNumber}</span>
                  <span className="text-xs ml-auto shrink-0" style={{ color: 'var(--muted)' }}>{t.latencyMs ? `${t.latencyMs}ms · ` : ''}{fmt(t.occurredAt)}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 space-y-2" style={{ borderTop: '1px solid var(--line)' }}>
                    {t.turnMessage && <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Mensagem do cliente: <span style={{ color: 'var(--ink-soft)' }}>"{t.turnMessage}"</span></p>}
                    {t.toolInput && (
                      <div><span className="mk-eyebrow" style={{ fontSize: '.56rem' }}>Argumentos</span>
                        <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono rounded-lg p-3 mt-1" style={{ color: 'var(--ink-soft)', background: 'var(--paper)' }}>{JSON.stringify(t.toolInput, null, 2)}</pre>
                      </div>
                    )}
                    {t.text && t.kind !== 'reply' && <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>{t.text}</p>}
                    {t.kind === 'reply' && t.text && <p className="text-sm" style={{ color: 'var(--ink-soft)', fontStyle: 'italic' }}>"{t.text}"</p>}
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {t.kind === 'tool' && <>resultado: <strong>{t.resultSuccess ? 'sucesso' : 'falha'}</strong> ({t.resultCode}) · </>}
                      {t.stopReason && <>stop: {t.stopReason} · </>}
                      {t.provider && <>provider: {t.provider} · </>}
                      conv: {t.conversationId?.slice(0, 8)}
                    </p>
                  </div>
                )}
              </MkCard>
            )
          })}
        </div>
      </div>
    </MkLayout>
  )
}
