import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Columns3, Clock, Flame } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { Eyebrow } from '../components/mkhub'
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
  color: string
  /** tags aplicadas ao arrastar um card PARA esta coluna */
  addTags: string[]
  /** tags removidas ao arrastar PARA esta coluna */
  removeTags: string[]
}

// Estágio é derivado (tags + conversa ativa) — arrastar aplica/remove tags via API.
const COLUMNS: Column[] = [
  { key: 'novo',     title: 'Novos',        color: '#6b7280', addTags: [], removeTags: ['lost'] },
  { key: 'conversa', title: 'Em conversa',  color: '#2563eb', addTags: ['high_intent'], removeTags: ['lost'] },
  { key: 'pix',      title: 'Pix gerado',   color: '#d97706', addTags: ['pix_generated'], removeTags: ['lost'] },
  { key: 'comprou',  title: 'Comprou',      color: '#16a34a', addTags: ['buyer'], removeTags: ['lost'] },
  { key: 'humano',   title: 'Atendimento',  color: '#dc2626', addTags: ['needs_human'], removeTags: [] },
  { key: 'perdido',  title: 'Perdido',      color: '#111827', addTags: ['lost'], removeTags: ['high_intent'] },
]

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

function fmtAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const TEMP_ICON: Record<string, string> = { hot: '🔥', vip: '⭐', warm: '🌤️', cold: '❄️' }

export function Kanban() {
  const { botId } = useParams<{ botId: string }>()
  const [leads, setLeads] = useState<Lead[]>([])
  const [convs, setConvs] = useState<LiveConv[]>([])
  const [dragPhone, setDragPhone] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

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
  const byCol = new Map<string, Lead[]>(COLUMNS.map(c => [c.key, []]))
  for (const lead of leads) byCol.get(stageOf(lead, activeByPhone))!.push(lead)

  const onDrop = async (col: Column) => {
    setOverCol(null)
    if (!botId || !dragPhone) return
    const lead = leads.find(l => l.phoneNumber === dragPhone)
    setDragPhone(null)
    if (!lead || stageOf(lead, activeByPhone) === col.key) return
    // otimista: aplica tags localmente e persiste
    const currentCol = COLUMNS.find(c => c.key === stageOf(lead, activeByPhone))
    const remove = [...new Set([...(col.removeTags), ...(currentCol?.addTags ?? [])])].filter(t => !col.addTags.includes(t))
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
      <div className="mx-auto" style={{ maxWidth: '96rem' }}>
        <div className="mb-7">
          <Eyebrow>Operação</Eyebrow>
          <h1 className="mk-display flex items-center gap-2" style={{ fontSize: '1.7rem', fontWeight: 700 }}>
            <Columns3 size={22} strokeWidth={1.7} /> Kanban
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {leads.length} leads · arraste um card pra mudar o estágio (aplica tags)
          </p>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))` }}>
          {COLUMNS.map(col => {
            const items = byCol.get(col.key)!
            return (
              <div key={col.key}
                onDragOver={e => { e.preventDefault(); setOverCol(col.key) }}
                onDragLeave={() => setOverCol(o => (o === col.key ? null : o))}
                onDrop={() => onDrop(col)}
                className="rounded-xl p-2"
                style={{
                  background: overCol === col.key ? 'rgba(37,99,235,0.06)' : 'var(--paper)',
                  border: `1px ${overCol === col.key ? 'dashed' : 'solid'} var(--line)`,
                  minHeight: '60vh',
                }}>
                <div className="flex items-center justify-between px-1.5 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: col.color }} />
                    {col.title}
                  </span>
                  <span className="text-xs font-semibold px-1.5 rounded" style={{ color: 'var(--muted)', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map(lead => (
                    <div key={lead.id}
                      draggable
                      onDragStart={() => setDragPhone(lead.phoneNumber)}
                      onDragEnd={() => setDragPhone(null)}
                      className="rounded-lg p-2.5 cursor-grab active:cursor-grabbing"
                      style={{
                        background: 'var(--paper-2)',
                        border: '1px solid var(--line)',
                        opacity: dragPhone === lead.phoneNumber ? 0.5 : 1,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{lead.name || lead.phoneNumber}</span>
                        <span className="text-xs">{TEMP_ICON[lead.leadTemperature] ?? ''}</span>
                      </div>
                      {lead.name && <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{lead.phoneNumber}</p>}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {lead.tags.slice(0, 3).map(t => (
                          <span key={t} className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between mt-1.5 text-[10px]" style={{ color: 'var(--muted)' }}>
                        <span className="flex items-center gap-1"><Clock size={9} /> {fmtAgo(lead.lastSeenAt)}</span>
                        <span className="flex items-center gap-1"><Flame size={9} /> {lead.totalSessions} sessõe{lead.totalSessions === 1 ? '' : 's'}</span>
                      </div>
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
