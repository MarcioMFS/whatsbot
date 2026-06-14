import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Users, Tag, Clock, MessageSquare, X, Filter } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, Eyebrow } from '../components/mkhub'
import { api } from '../api/client.ts'

interface LeadData {
  id: string; phoneNumber: string; name: string | null; tags: string[]
  variables: Record<string, string>; totalSessions: number
  leadTemperature: 'cold' | 'warm' | 'hot' | 'vip'; purchasedTitles: string[]
  lastSeenAt: string; createdAt: string
}

const TEMP_COLORS: Record<string, string> = { cold: 'var(--muted)', warm: '#9a7400', hot: '#c2410c', vip: 'var(--ink)' }
const TEMP_LABELS: Record<string, string> = { cold: 'frio', warm: 'morno', hot: 'quente', vip: 'VIP' }

const ALL_TAGS = ['buyer', 'sent_pix', 'pix_generated', 'high_intent', 'vip', 'needs_human', 'lost', 'interested', 'no_budget', 'blocked']

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'agora'; if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

export function Leads() {
  const { botId } = useParams<{ botId: string }>()
  const [leads, setLeads] = useState<LeadData[]>([])
  const [total, setTotal] = useState(0)
  const [tagFilter, setTagFilter] = useState('')
  const [selected, setSelected] = useState<LeadData | null>(null)
  const [allTags, setAllTags] = useState<string[]>([])

  useEffect(() => {
    if (!botId) return
    api.leads.list(botId, tagFilter || undefined).then(data => {
      const ls = data.leads as LeadData[]
      setLeads(ls); setTotal(data.total)
      setAllTags(Array.from(new Set(ls.flatMap(l => l.tags))).sort())
    })
  }, [botId, tagFilter])

  const handleTagToggle = async (lead: LeadData, tag: string) => {
    const isAdding = !lead.tags.includes(tag)
    await api.leads.updateTags(botId!, lead.phoneNumber, { add: isAdding ? [tag] : [], remove: isAdding ? [] : [tag] })
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, tags: isAdding ? [...l.tags, tag] : l.tags.filter(t => t !== tag) } : l))
    if (selected?.id === lead.id) {
      setSelected(prev => prev ? { ...prev, tags: isAdding ? [...prev.tags, tag] : prev.tags.filter(t => t !== tag) } : null)
    }
  }

  const tagChip = (selectedState: boolean) => selectedState
    ? { background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' }
    : { background: 'var(--paper-2)', color: 'var(--muted)', border: '1px solid var(--line)' }

  return (
    <MkLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-7">
          <div>
            <Eyebrow>Operação</Eyebrow>
            <h1 className="mk-display flex items-center gap-2" style={{ fontSize: '1.7rem', fontWeight: 700 }}>
              <Users size={22} strokeWidth={1.7} /> Leads
            </h1>
            <p className="text-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>{total} leads capturados</p>
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: 'var(--muted)' }} />
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="mk-input text-sm px-3 py-1.5">
              <option value="">Todas as tags</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* List */}
          <div className="lg:col-span-2 space-y-2">
            {leads.length === 0 && (
              <MkCard style={{ padding: '64px 0', textAlign: 'center', color: 'var(--muted)' }}>
                <MessageSquare size={32} strokeWidth={1.3} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p>Nenhum lead ainda</p>
              </MkCard>
            )}
            {leads.map(lead => (
              <MkCard key={lead.id} onClick={() => setSelected(lead)} style={{ padding: 16, border: selected?.id === lead.id ? '1px solid var(--ink)' : '1px solid var(--line)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate" style={{ color: 'var(--ink)' }}>{lead.name ?? lead.phoneNumber}</p>
                    {lead.name && <p className="text-xs" style={{ color: 'var(--muted)' }}>{lead.phoneNumber}</p>}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {lead.tags.map(tag => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-xs" style={{ color: 'var(--muted)' }}>
                    <p className="flex items-center gap-1 justify-end"><Clock size={11} />{timeAgo(lead.lastSeenAt)}</p>
                    <p className="mt-1">{lead.totalSessions} sess{lead.totalSessions === 1 ? 'ão' : 'ões'}</p>
                    <p className="mt-1 font-medium" style={{ color: TEMP_COLORS[lead.leadTemperature ?? 'cold'] }}>{TEMP_LABELS[lead.leadTemperature ?? 'cold']}</p>
                    {lead.purchasedTitles?.length > 0 && <p className="mt-1" style={{ color: '#1d7a52' }}>{lead.purchasedTitles.length} compra{lead.purchasedTitles.length > 1 ? 's' : ''}</p>}
                  </div>
                </div>
              </MkCard>
            ))}
          </div>

          {/* Detail */}
          <div>
            {selected ? (
              <MkCard style={{ padding: 22 }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="mk-display font-semibold">{selected.name ?? selected.phoneNumber}</p>
                    {selected.name && <p className="text-xs" style={{ color: 'var(--muted)' }}>{selected.phoneNumber}</p>}
                  </div>
                  <button onClick={() => setSelected(null)} style={{ color: 'var(--muted)' }} className="hover:opacity-60"><X size={16} /></button>
                </div>

                <div className="mb-4">
                  <p className="text-xs mb-2 flex items-center gap-1" style={{ color: 'var(--muted)' }}><Tag size={11} /> Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_TAGS.map(tag => (
                      <button key={tag} onClick={() => handleTagToggle(selected, tag)} className="text-xs px-2.5 py-1 rounded-full transition-all" style={tagChip(selected.tags.includes(tag))}>{tag}</button>
                    ))}
                  </div>
                </div>

                {Object.keys(selected.variables).length > 0 && (
                  <div>
                    <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>Variáveis</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {Object.entries(selected.variables).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="shrink-0" style={{ color: 'var(--muted)' }}>{k}:</span>
                          <span className="truncate" style={{ color: 'var(--ink-soft)' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-4 text-xs space-y-1" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}>
                  <p>Sessões: {selected.totalSessions}</p>
                  <p>Último contato: {timeAgo(selected.lastSeenAt)}</p>
                  <p>Desde: {new Date(selected.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
              </MkCard>
            ) : (
              <MkCard style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem' }}>Selecione um lead para ver detalhes</MkCard>
            )}
          </div>
        </div>
      </div>
    </MkLayout>
  )
}
