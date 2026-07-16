import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Columns3, Clock } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { Eyebrow, MkCard } from '../components/mkhub'
import { api } from '../api/client.ts'

interface Lead {
  id: string
  phoneNumber: string
  name: string | null
  tags: string[]
  leadTemperature: string
  totalSessions: number
  lastSeenAt: string
}
interface LiveConv { phoneNumber: string; status: string; phase?: string }

interface Column {
  key: string
  title: string
  dot: string
  /** tags aplicadas ao arrastar um card PARA esta coluna */
  addTags: string[]
  /** tags removidas ao arrastar PARA esta coluna */
  removeTags: string[]
}

// Estágio é derivado (tags + conversa ativa) — arrastar aplica/remove tags via API.
const COLUMNS: Column[] = [
  { key: 'novo',     title: 'Novos',       dot: 'var(--muted)', addTags: [], removeTags: ['lost'] },
  { key: 'conversa', title: 'Em conversa', dot: '#9a7400',      addTags: ['high_intent'], removeTags: ['lost'] },
  { key: 'pix',      title: 'Pix gerado',  dot: '#b45309',      addTags: ['pix_generated'], removeTags: ['lost'] },
  { key: 'comprou',  title: 'Comprou',     dot: '#1d7a52',      addTags: ['buyer'], removeTags: ['lost'] },
  { key: 'humano',   title: 'Atendimento', dot: '#c2410c',      addTags: ['needs_human'], removeTags: [] },
  { key: 'perdido',  title: 'Perdido',     dot: 'var(--ink)',   addTags: ['lost'], removeTags: ['high_intent'] },
]

const TEMP_COLORS: Record<string, string> = { cold: 'var(--muted)', warm: '#9a7400', hot: '#c2410c', vip: 'var(--ink)' }
const TEMP_LABELS: Record<string, string> = { cold: 'frio', warm: 'morno', hot: 'quente', vip: 'VIP' }

function stageOf(lead: Lead, activeByPhone: Map<string, LiveConv>): string {
  const t = new Set(lead.tags)
  if (t.has('buyer')) return 'comprou'
  if (t.has('needs_human')) return 'humano'
  if (t.has('lost')) return 'perdido'
  const conv = activeByPhone.get(lead.phoneNumber)
  if (conv?.status === 'handoff') return 'humano'
  if (t.has('pix_generated') || t.has('eduzzy-checkout') || t.has('sent_pix') || conv?.phase === 'awaiting_payment') return 'pix'
  if (conv || t.has('high_intent')) return 'conversa'
  return 'novo'
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function Kanban() {
  const { botId } = useParams<{ botId: string }>()
  const [leads, setLeads] = useState<Lead[]>([])
  const [convs, setConvs] = useState<LiveConv[]>([])
  const [dragPhone, setDragPhone] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  // filtros do quadro (client-side — leads já vêm inteiros no polling)
  const [q, setQ] = useState('')
  const [fTemp, setFTemp] = useState<string | null>(null)
  const [fTag, setFTag] = useState<string | null>(null)
  const [fDays, setFDays] = useState<number | null>(null)

  const load = useCallback(() => {
    if (!botId) return
    Promise.all([api.leads.list(botId), api.conversations.live(botId)])
      .then(([l, c]) => {
        setLeads((l as { leads: Lead[] }).leads)
        setConvs(c as LiveConv[])
      })
      .catch(() => {})
  }, [botId])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  const activeByPhone = new Map(convs.map(c => [c.phoneNumber, c]))

  // tags existentes (com contagem) — alimenta o filtro por tag
  const tagCounts = new Map<string, number>()
  for (const l of leads) for (const t of l.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)

  const needle = q.trim().toLowerCase()
  const cutoff = fDays ? Date.now() - fDays * 86_400_000 : null
  const visibleLeads = leads.filter(l => {
    if (fTemp && l.leadTemperature !== fTemp) return false
    if (fTag && !l.tags.includes(fTag)) return false
    if (cutoff && new Date(l.lastSeenAt).getTime() < cutoff) return false
    if (needle && !l.phoneNumber.toLowerCase().includes(needle) && !(l.name ?? '').toLowerCase().includes(needle)) return false
    return true
  })
  const filtersActive = !!(needle || fTemp || fTag || fDays)

  const byCol = new Map<string, Lead[]>(COLUMNS.map(c => [c.key, []]))
  for (const lead of visibleLeads) byCol.get(stageOf(lead, activeByPhone))!.push(lead)

  const onDrop = async (col: Column) => {
    setOverCol(null)
    if (!botId || !dragPhone) return
    const lead = leads.find(l => l.phoneNumber === dragPhone)
    setDragPhone(null)
    if (!lead || stageOf(lead, activeByPhone) === col.key) return
    // otimista: aplica tags localmente e persiste
    const currentCol = COLUMNS.find(c => c.key === stageOf(lead, activeByPhone))
    const remove = [...new Set([...col.removeTags, ...(currentCol?.addTags ?? [])])].filter(t => !col.addTags.includes(t))
    setLeads(ls => ls.map(l => l.phoneNumber !== lead.phoneNumber ? l : {
      ...l, tags: [...new Set([...l.tags.filter(t => !remove.includes(t)), ...col.addTags])],
    }))
    try {
      await api.leads.updateTags(botId, lead.phoneNumber, { add: col.addTags, remove })
    } finally {
      load()
    }
  }

  return (
    <MkLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-7">
          <div>
            <Eyebrow>Operação</Eyebrow>
            <h1 className="mk-display flex items-center gap-2" style={{ fontSize: '1.7rem', fontWeight: 700 }}>
              <Columns3 size={22} strokeWidth={1.7} /> Kanban
            </h1>
            <p className="text-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>
              {filtersActive ? `${visibleLeads.length} de ${leads.length} leads (filtro ativo)` : `${leads.length} leads — arraste um card pra mudar de estágio`}
            </p>
          </div>
        </div>

        {/* filtros: busca + temperatura + tag + período (last seen) */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            className="mk-input text-sm"
            style={{ padding: '8px 14px', width: 220 }}
            placeholder="Buscar nome ou número…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {([[null, 'todas'], ...Object.entries(TEMP_LABELS)] as Array<[string | null, string]>).map(([key, label]) => {
            const active = fTemp === key
            const count = key === null ? leads.length : leads.filter(l => l.leadTemperature === key).length
            return (
              <button key={label} onClick={() => setFTemp(key)}
                className="rounded-full text-xs font-medium transition-all"
                style={active
                  ? { background: 'var(--ink)', color: 'var(--paper)', padding: '7px 13px' }
                  : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '6px 12px' }}>
                {label} {count > 0 && <span style={{ opacity: 0.65 }}>{count}</span>}
              </button>
            )
          })}
          <select
            className="mk-input text-xs"
            style={{ padding: '8px 10px', maxWidth: 200 }}
            value={fTag ?? ''}
            onChange={e => setFTag(e.target.value || null)}
          >
            <option value="">todas as tags</option>
            {[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <option key={t} value={t}>{t} ({n})</option>
            ))}
          </select>
          <select
            className="mk-input text-xs"
            style={{ padding: '8px 10px' }}
            value={fDays ?? ''}
            onChange={e => setFDays(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">qualquer período</option>
            <option value="1">últimas 24h</option>
            <option value="3">últimos 3 dias</option>
            <option value="7">últimos 7 dias</option>
            <option value="30">últimos 30 dias</option>
          </select>
          {filtersActive && (
            <button onClick={() => { setQ(''); setFTemp(null); setFTag(null); setFDays(null) }}
              className="text-xs underline" style={{ color: 'var(--muted)' }}>
              limpar
            </button>
          )}
        </div>

        {/* Quadro na altura da viewport: colunas rolam POR DENTRO (vertical) e o
            scroll horizontal fica sempre à vista — sem precisar descer a página. */}
        <div className="flex gap-4 overflow-x-auto pb-2" style={{ height: 'calc(100vh - 200px)' }}>
          {COLUMNS.map(col => {
            const items = byCol.get(col.key)!
            const isOver = overCol === col.key
            return (
              <div key={col.key}
                onDragOver={e => { e.preventDefault(); setOverCol(col.key) }}
                onDragLeave={() => setOverCol(o => (o === col.key ? null : o))}
                onDrop={() => onDrop(col)}
                className="shrink-0 rounded-2xl transition-all flex flex-col"
                style={{
                  width: 250,
                  padding: '12px 10px',
                  background: isOver ? 'var(--paper-2)' : 'transparent',
                  border: isOver ? '1px dashed var(--ink)' : '1px dashed transparent',
                  height: '100%',
                }}>
                <div className="flex items-center justify-between px-1.5 mb-3">
                  <span className="mk-eyebrow inline-flex items-center gap-2" style={{ fontSize: '.62rem' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.dot, display: 'inline-block' }} />
                    {col.title}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{items.length}</span>
                </div>
                <div className="space-y-2 overflow-y-auto flex-1 pr-0.5">
                  {items.length === 0 && (
                    <div className="rounded-xl text-center text-xs py-6"
                      style={{ color: 'var(--muted)', border: '1px dashed var(--line)' }}>
                      vazio
                    </div>
                  )}
                  {items.map(lead => (
                    <div key={lead.id}
                      draggable
                      onDragStart={() => setDragPhone(lead.phoneNumber)}
                      onDragEnd={() => setDragPhone(null)}
                      style={{ opacity: dragPhone === lead.phoneNumber ? 0.45 : 1, cursor: 'grab' }}>
                      <MkCard style={{ padding: 13 }}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm truncate" style={{ color: 'var(--ink)' }}>
                            {lead.name || lead.phoneNumber}
                          </p>
                          <span className="text-[11px] font-medium shrink-0" style={{ color: TEMP_COLORS[lead.leadTemperature] ?? 'var(--muted)' }}>
                            {TEMP_LABELS[lead.leadTemperature] ?? ''}
                          </span>
                        </div>
                        {lead.name && <p className="text-xs" style={{ color: 'var(--muted)' }}>{lead.phoneNumber}</p>}
                        {lead.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {lead.tags.slice(0, 3).map(t => (
                              <span key={t} className="text-xs px-2 py-0.5 rounded-full"
                                style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
                                {t}
                              </span>
                            ))}
                            {lead.tags.length > 3 && (
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>+{lead.tags.length - 3}</span>
                            )}
                          </div>
                        )}
                        <p className="flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--muted)' }}>
                          <Clock size={11} /> {timeAgo(lead.lastSeenAt)} · {lead.totalSessions} sess{lead.totalSessions === 1 ? 'ão' : 'ões'}
                        </p>
                      </MkCard>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </MkLayout>
  )
}
