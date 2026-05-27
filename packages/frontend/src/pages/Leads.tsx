import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Users, Tag, Clock, MessageSquare, X, Filter } from 'lucide-react'
import { Layout } from '../components/ui/Layout.tsx'
import { GlassCard } from '../components/ui/GlassCard.tsx'
import { api } from '../api/client.ts'

interface LeadData {
  id: string
  phoneNumber: string
  name: string | null
  tags: string[]
  variables: Record<string, string>
  totalSessions: number
  leadTemperature: 'cold' | 'warm' | 'hot' | 'vip'
  purchasedTitles: string[]
  lastSeenAt: string
  createdAt: string
}

const TEMP_COLORS: Record<string, string> = {
  cold: 'text-slate-400',
  warm: 'text-yellow-400',
  hot:  'text-orange-400',
  vip:  'text-purple-400',
}
const TEMP_LABELS: Record<string, string> = {
  cold: 'frio', warm: 'morno', hot: 'quente', vip: 'VIP',
}

const TAG_COLORS: Record<string, string> = {
  // set by backend automatically
  buyer:           'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  sent_pix:        'bg-teal-500/20 text-teal-300 border-teal-500/30',
  pix_generated:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  needs_human:     'bg-red-500/20 text-red-300 border-red-500/30',
  lost:            'bg-slate-500/20 text-slate-300 border-slate-500/30',
  high_intent:     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  vip:             'bg-purple-500/20 text-purple-300 border-purple-500/30',
  // set manually
  interested:      'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  no_budget:       'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
  blocked:         'bg-rose-500/20 text-rose-300 border-rose-500/30',
}

function tagColor(tag: string) {
  return TAG_COLORS[tag] ?? 'bg-brand-500/20 text-brand-300 border-brand-500/30'
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h atrás`
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
      const leads = data.leads as LeadData[]
      setLeads(leads)
      setTotal(data.total)
      const tags = Array.from(new Set(leads.flatMap(l => l.tags))).sort()
      setAllTags(tags)
    })
  }, [botId, tagFilter])

  const handleTagToggle = async (lead: LeadData, tag: string) => {
    const isAdding = !lead.tags.includes(tag)
    await api.leads.updateTags(botId!, lead.phoneNumber, {
      add: isAdding ? [tag] : [],
      remove: isAdding ? [] : [tag],
    })
    setLeads(prev => prev.map(l => l.id === lead.id
      ? { ...l, tags: isAdding ? [...l.tags, tag] : l.tags.filter(t => t !== tag) }
      : l
    ))
    if (selected?.id === lead.id) {
      setSelected(prev => prev ? {
        ...prev,
        tags: isAdding ? [...prev.tags, tag] : prev.tags.filter(t => t !== tag)
      } : null)
    }
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users size={22} className="text-brand-400" /> Leads
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">{total} leads capturados</p>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400" />
            <select
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              className="bg-slate-800/60 border border-slate-700/50 text-slate-300 text-sm rounded-lg px-3 py-1.5 outline-none"
            >
              <option value="">Todas as tags</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Lead list */}
          <div className="lg:col-span-2 space-y-2">
            {leads.length === 0 && (
              <div className="glass text-center py-16 text-slate-400">
                <MessageSquare size={32} className="mx-auto mb-3 opacity-40" />
                <p>Nenhum lead ainda</p>
              </div>
            )}
            {leads.map(lead => (
              <div
                key={lead.id}
                onClick={() => setSelected(lead)}
                className={`glass p-4 cursor-pointer transition-all duration-150 hover:border-brand-500/40 ${selected?.id === lead.id ? 'border-brand-500/60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{lead.name ?? lead.phoneNumber}</p>
                    {lead.name && <p className="text-slate-500 text-xs">{lead.phoneNumber}</p>}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {lead.tags.map(tag => (
                        <span key={tag} className={`text-xs px-2 py-0.5 rounded-full border ${tagColor(tag)}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-xs text-slate-500">
                    <p className="flex items-center gap-1 justify-end"><Clock size={11} />{timeAgo(lead.lastSeenAt)}</p>
                    <p className="mt-1">{lead.totalSessions} sess{lead.totalSessions === 1 ? 'ão' : 'ões'}</p>
                    <p className={`mt-1 font-medium ${TEMP_COLORS[lead.leadTemperature ?? 'cold']}`}>{TEMP_LABELS[lead.leadTemperature ?? 'cold']}</p>
                    {lead.purchasedTitles?.length > 0 && (
                      <p className="mt-1 text-emerald-400">{lead.purchasedTitles.length} compra{lead.purchasedTitles.length > 1 ? 's' : ''}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Lead detail */}
          <div>
            {selected ? (
              <GlassCard>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-white font-semibold">{selected.name ?? selected.phoneNumber}</p>
                    {selected.name && <p className="text-slate-400 text-xs">{selected.phoneNumber}</p>}
                  </div>
                  <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white">
                    <X size={16} />
                  </button>
                </div>

                <div className="mb-4">
                  <p className="text-xs text-slate-500 mb-2 flex items-center gap-1"><Tag size={11} /> Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['buyer', 'sent_pix', 'pix_generated', 'high_intent', 'vip', 'needs_human', 'lost', 'interested', 'no_budget', 'blocked'].map(tag => (
                      <button
                        key={tag}
                        onClick={() => handleTagToggle(selected, tag)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                          selected.tags.includes(tag) ? tagColor(tag) : 'border-slate-700 text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                {Object.keys(selected.variables).length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-2">Variáveis</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {Object.entries(selected.variables).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="text-slate-500 shrink-0">{k}:</span>
                          <span className="text-slate-300 truncate">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-slate-700/50 text-xs text-slate-500 space-y-1">
                  <p>Sessões: {selected.totalSessions}</p>
                  <p>Último contato: {timeAgo(selected.lastSeenAt)}</p>
                  <p>Desde: {new Date(selected.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
              </GlassCard>
            ) : (
              <div className="glass p-6 text-center text-slate-500 text-sm">
                Selecione um lead para ver detalhes
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
