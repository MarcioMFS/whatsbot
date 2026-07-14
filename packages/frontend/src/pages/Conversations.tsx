import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MessageCircle, Clock, Bot, User, RadioTower, Send, Pause, Play } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { Eyebrow, MkCard } from '../components/mkhub'
import { api } from '../api/client.ts'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}
interface Conv {
  id: string
  phoneNumber: string
  status: string
  phase?: string
  currentNodeId?: string
  history: Msg[]
  updatedAt: string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:    { label: 'Ativa',      color: '#16a34a' },
  waiting:   { label: 'Aguardando', color: '#2563eb' },
  suspended: { label: 'Suspensa',   color: '#d97706' },
  handoff:   { label: 'Humano',     color: '#dc2626' },
}

function fmtTime(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function Conversations() {
  const { botId } = useParams<{ botId: string }>()
  const [convs, setConvs] = useState<Conv[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const lastLenRef = useRef(0)

  const load = useCallback(() => {
    if (!botId) return
    api.conversations.live(botId)
      .then(data => { setConvs(data as Conv[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [botId])

  // Polling: painel "ao vivo" (padrão da casa — sem websocket)
  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  const conv = convs.find(c => c.id === selected) ?? null

  const sendManual = async () => {
    if (!botId || !conv || !draft.trim() || sending) return
    setSending(true)
    try {
      await api.conversations.send(botId, conv.phoneNumber, draft.trim())
      setDraft('')
      load()
    } finally {
      setSending(false)
    }
  }

  const togglePause = async () => {
    if (!botId || !conv) return
    if (conv.status === 'handoff') await api.conversations.resume(botId, conv.phoneNumber)
    else await api.conversations.pause(botId, conv.phoneNumber)
    load()
  }

  // auto-scroll quando chegam mensagens novas
  useEffect(() => {
    const len = conv?.history.length ?? 0
    if (len !== lastLenRef.current) {
      lastLenRef.current = len
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [conv?.history.length])

  return (
    <MkLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-7">
          <div>
            <Eyebrow>Operação</Eyebrow>
            <h1 className="mk-display flex items-center gap-2" style={{ fontSize: '1.7rem', fontWeight: 700 }}>
              <MessageCircle size={22} strokeWidth={1.7} /> Conversas ao vivo
            </h1>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {convs.length} conversa{convs.length === 1 ? '' : 's'} em andamento · atualiza a cada 4s
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: '#16a34a' }}>
            <RadioTower size={14} /> ao vivo
          </span>
        </div>

        <div className="grid lg:grid-cols-3 gap-5" style={{ minHeight: '60vh' }}>
          {/* lista de conversas */}
          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '72vh' }}>
            {loading && <p className="text-sm" style={{ color: 'var(--muted)' }}>Carregando…</p>}
            {!loading && convs.length === 0 && (
              <MkCard><p className="text-sm" style={{ color: 'var(--muted)' }}>Nenhuma conversa ativa agora.</p></MkCard>
            )}
            {convs.map(c => {
              const st = STATUS_LABEL[c.status] ?? { label: c.status, color: 'var(--muted)' }
              const last = c.history[c.history.length - 1]
              return (
                <button key={c.id} onClick={() => setSelected(c.id)} className="w-full text-left">
                  <MkCard className={selected === c.id ? 'mk-card-hover' : ''}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{c.phoneNumber}</span>
                      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                        <Clock size={11} /> {fmtAgo(c.updatedAt)}
                      </span>
                    </div>
                    <p className="text-xs mt-1 truncate" style={{ color: 'var(--muted)' }}>
                      {last ? `${last.role === 'user' ? '👤' : '🤖'} ${last.content.slice(0, 60)}` : '—'}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: '#fff', background: st.color }}>
                        {st.label}
                      </span>
                      {c.phase && <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{c.phase}</span>}
                    </div>
                  </MkCard>
                </button>
              )
            })}
          </div>

          {/* chat */}
          <div className="lg:col-span-2">
            <MkCard>
              {!conv ? (
                <div className="flex items-center justify-center" style={{ height: '64vh', color: 'var(--muted)' }}>
                  <p className="text-sm">Selecione uma conversa à esquerda</p>
                </div>
              ) : (
                <div className="flex flex-col" style={{ height: '64vh' }}>
                  <div className="flex items-center justify-between pb-3 mb-3" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div>
                      <p className="font-semibold text-sm">{conv.phoneNumber}</p>
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        {conv.history.length} mensagens · nó atual: {conv.currentNodeId ?? '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ color: '#fff', background: (STATUS_LABEL[conv.status] ?? { color: 'var(--muted)' }).color }}>
                        {(STATUS_LABEL[conv.status] ?? { label: conv.status }).label}
                      </span>
                      <button onClick={togglePause}
                        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg"
                        style={conv.status === 'handoff'
                          ? { background: '#16a34a', color: '#fff' }
                          : { background: 'var(--paper)', border: '1px solid var(--line)' }}>
                        {conv.status === 'handoff'
                          ? <><Play size={11} /> Devolver pro bot</>
                          : <><Pause size={11} /> Pausar bot</>}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {conv.history.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap"
                          style={m.role === 'assistant'
                            ? { background: 'var(--ink)', color: '#fff', borderBottomRightRadius: 6 }
                            : { background: 'var(--paper)', border: '1px solid var(--line)', borderBottomLeftRadius: 6 }}>
                          <div className="flex items-center gap-1.5 mb-0.5 text-[10px]" style={{ opacity: 0.65 }}>
                            {m.role === 'assistant' ? <Bot size={10} /> : <User size={10} />}
                            {fmtTime(m.timestamp)}
                          </div>
                          {m.content}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex items-center gap-2 pt-3 mt-2" style={{ borderTop: '1px solid var(--line)' }}>
                    <input
                      className="mk-input flex-1"
                      placeholder={conv.status === 'handoff'
                        ? 'Você está no controle — escreva pro lead…'
                        : 'Mensagem manual (o funil continua ativo)…'}
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendManual() } }}
                    />
                    <button onClick={sendManual} disabled={sending || !draft.trim()}
                      className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg"
                      style={{ background: 'var(--ink)', color: '#fff', opacity: sending || !draft.trim() ? 0.5 : 1 }}>
                      <Send size={13} /> Enviar
                    </button>
                  </div>
                </div>
              )}
            </MkCard>
          </div>
        </div>
      </div>
    </MkLayout>
  )
}
