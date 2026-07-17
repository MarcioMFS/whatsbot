import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MessageCircle, Clock, Send, Pause, Play, Gift, SkipForward } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { Eyebrow, MkCard } from '../components/mkhub'
import { api } from '../api/client.ts'

interface MsgMedia {
  type: 'image' | 'video' | 'audio' | 'document'
  url?: string
  filename?: string
}
interface Msg {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  media?: MsgMedia
}

// Prévia da última mensagem na lista (ícone por tipo de mídia)
const MEDIA_ICON: Record<MsgMedia['type'], string> = { image: '📷', video: '🎥', audio: '🎙️', document: '📄' }
const MEDIA_NAME: Record<MsgMedia['type'], string> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento' }
function msgPreview(m?: Msg): string {
  if (!m) return '—'
  const text = m.content && m.content !== '[image]' ? m.content : ''
  if (m.media) return `${MEDIA_ICON[m.media.type]} ${text || m.media.filename || MEDIA_NAME[m.media.type]}`
  return text || '—'
}
interface Conv {
  id: string
  phoneNumber: string
  status: string
  phase?: string
  flowId?: string
  currentNodeId?: string
  history: Msg[]
  updatedAt: string
}

interface FlowNodeLite {
  id: string
  type: string
  label: string
}

// Acentos discretos (padrão editorial: dot colorido + texto muted, nunca badge saturado)
const STATUS: Record<string, { label: string; dot: string }> = {
  active:    { label: 'ativa',      dot: '#1d7a52' },
  waiting:   { label: 'aguardando', dot: '#9a7400' },
  suspended: { label: 'suspensa',   dot: 'var(--muted)' },
  handoff:   { label: 'com você',   dot: '#c2410c' },
  ended:     { label: 'encerrada',  dot: 'var(--line)' },
}

// Formatação do WhatsApp nas bolhas: *negrito*, _itálico_, ~tachado~ (com escape de HTML antes)
function waHtml(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
}

function fmtTime(ts?: string): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

function StatusDot({ status }: { status: string }) {
  const st = STATUS[status] ?? { label: status, dot: 'var(--muted)' }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot, display: 'inline-block' }} />
      {st.label}
    </span>
  )
}

export function Conversations() {
  const { botId } = useParams<{ botId: string }>()
  const [convs, setConvs] = useState<Conv[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [deliverables, setDeliverables] = useState<{ available: boolean; docs: number }>({ available: false, docs: 0 })
  const [delivering, setDelivering] = useState(false)
  const [flowNodes, setFlowNodes] = useState<Record<string, FlowNodeLite[]>>({})
  const [gotoSel, setGotoSel] = useState<string | null>(null)
  const [firing, setFiring] = useState(false)
  // filtros da lista (client-side — os dados já chegam inteiros no polling)
  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState<string | null>(null)
  const [fNode, setFNode] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const lastLenRef = useRef(0)

  const load = useCallback(() => {
    if (!botId) return
    // ativas (Redis) + encerradas (histórico no banco) — inbox completo
    Promise.all([
      api.conversations.live(botId),
      api.conversations.list(botId, 100).catch(() => []),
    ])
      .then(([live, ended]) => {
        const liveArr = live as Conv[]
        const liveIds = new Set(liveArr.map(c => c.id))
        const endedArr = (ended as Conv[]).filter(c => !liveIds.has(c.id))
        const all = [...liveArr, ...endedArr].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        setConvs(all)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [botId])

  // Polling: painel "ao vivo" (padrão da casa — sem websocket)
  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!botId) return
    api.conversations.deliverables(botId).then(setDeliverables).catch(() => {})
    // nós de cada flow do bot — alimenta o controle "disparar daqui" e o rótulo do nó atual
    api.flows.list(botId).then(flows => {
      const map: Record<string, FlowNodeLite[]> = {}
      for (const f of flows as Array<{ id: string; nodes?: Array<{ id: string; type: string; data?: { label?: string } }> }>) {
        map[f.id] = (f.nodes ?? []).map(nd => ({ id: nd.id, type: nd.type, label: nd.data?.label || nd.id }))
      }
      setFlowNodes(map)
    }).catch(() => {})
  }, [botId])

  const conv = convs.find(c => c.id === selected) ?? null
  const nodes = (conv?.flowId && flowNodes[conv.flowId]) || []
  const currentNode = nodes.find(nd => nd.id === conv?.currentNodeId) ?? null

  // etapas presentes nas conversas carregadas (rótulo do flow + contagem) — alimenta o filtro
  const nodeCounts = new Map<string, { label: string; count: number }>()
  for (const c of convs) {
    if (!c.currentNodeId) continue
    const label = (c.flowId && flowNodes[c.flowId]?.find(nd => nd.id === c.currentNodeId)?.label) || c.currentNodeId
    nodeCounts.set(c.currentNodeId, { label, count: (nodeCounts.get(c.currentNodeId)?.count ?? 0) + 1 })
  }

  const needle = q.trim().toLowerCase()
  const visible = convs.filter(c => {
    if (fStatus && c.status !== fStatus) return false
    if (fNode && c.currentNodeId !== fNode) return false
    if (needle) {
      const last = c.history[c.history.length - 1]?.content ?? ''
      if (!c.phoneNumber.toLowerCase().includes(needle) && !last.toLowerCase().includes(needle)) return false
    }
    return true
  })
  const filtersActive = !!(needle || fStatus || fNode)

  // troca de conversa → o seletor volta a seguir o nó atual dela
  useEffect(() => { setGotoSel(null) }, [selected])

  // auto-scroll quando chegam mensagens novas
  useEffect(() => {
    const len = conv?.history.length ?? 0
    if (len !== lastLenRef.current) {
      lastLenRef.current = len
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [conv?.history.length])

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

  const paused = conv?.status === 'handoff'

  const deliverNow = async () => {
    if (!botId || !conv || delivering) return
    if (!window.confirm(`Enviar os entregáveis (${deliverables.docs} arquivos) para ${conv.phoneNumber} agora? O lead será marcado como comprador.`)) return
    setDelivering(true)
    try {
      await api.conversations.deliver(botId, conv.phoneNumber)
      load()
    } catch (e) {
      window.alert(`Falha na entrega: ${(e as Error).message}`)
    } finally {
      setDelivering(false)
    }
  }

  // Dispara o funil a partir do nó escolhido (voltar/adiantar a conversa)
  const fireGoto = async () => {
    if (!botId || !conv || firing) return
    const nodeId = gotoSel ?? conv.currentNodeId
    if (!nodeId) return
    const label = nodes.find(nd => nd.id === nodeId)?.label ?? nodeId
    if (!window.confirm(`Disparar o funil a partir de "${label}" para ${conv.phoneNumber}?\n\nAs mensagens desse ponto serão enviadas agora e a conversa passa a seguir dali (se estava com você, volta pro bot).`)) return
    setFiring(true)
    try {
      await api.conversations.goto(botId, conv.phoneNumber, nodeId)
      setGotoSel(null)
      load()
    } catch (e) {
      window.alert(`Falha ao disparar: ${(e as Error).message}`)
    } finally {
      setFiring(false)
    }
  }

  return (
    <MkLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-7">
          <div>
            <Eyebrow>Operação</Eyebrow>
            <h1 className="mk-display flex items-center gap-2" style={{ fontSize: '1.7rem', fontWeight: 700 }}>
              <MessageCircle size={22} strokeWidth={1.7} /> Conversas
            </h1>
            <p className="text-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>
              {filtersActive
                ? `${visible.length} de ${convs.length} conversas (filtro ativo)`
                : `${convs.filter(c => c.status !== 'ended').length} em andamento · ${convs.filter(c => c.status === 'ended').length} encerradas`}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1d7a52' }} />
            ao vivo · 4s
          </span>
        </div>

        {/* filtros: busca + status + etapa do funil */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            className="mk-input text-sm"
            style={{ padding: '8px 14px', width: 230 }}
            placeholder="Buscar número ou mensagem…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {([[null, 'todas'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label] as [string, string])] as Array<[string | null, string]>).map(([key, label]) => {
            const active = fStatus === key
            const count = key === null ? convs.length : convs.filter(c => c.status === key).length
            return (
              <button key={label} onClick={() => setFStatus(key)}
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
            style={{ padding: '8px 10px', maxWidth: 240 }}
            value={fNode ?? ''}
            onChange={e => setFNode(e.target.value || null)}
          >
            <option value="">todas as etapas</option>
            {[...nodeCounts.entries()].sort((a, b) => b[1].count - a[1].count).map(([id, v]) => (
              <option key={id} value={id}>{v.label} ({v.count})</option>
            ))}
          </select>
          {filtersActive && (
            <button onClick={() => { setQ(''); setFStatus(null); setFNode(null) }}
              className="text-xs underline" style={{ color: 'var(--muted)' }}>
              limpar
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* lista de conversas */}
          <div className="space-y-2 overflow-y-auto pr-0.5" style={{ maxHeight: '72vh' }}>
            {loading && <p className="text-sm" style={{ color: 'var(--muted)' }}>Carregando…</p>}
            {!loading && visible.length === 0 && (
              <MkCard style={{ padding: '64px 0', textAlign: 'center', color: 'var(--muted)' }}>
                <MessageCircle size={32} strokeWidth={1.3} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p className="text-sm">{convs.length === 0 ? 'Nenhuma conversa ativa agora' : 'Nada com esses filtros'}</p>
              </MkCard>
            )}
            {visible.map(c => {
              const last = c.history[c.history.length - 1]
              const isSel = selected === c.id
              return (
                <MkCard key={c.id} onClick={() => setSelected(c.id)}
                  style={{ padding: 14, border: isSel ? '1px solid var(--ink)' : '1px solid var(--line)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm truncate" style={{ color: 'var(--ink)' }}>{c.phoneNumber}</p>
                    <span className="text-xs shrink-0 inline-flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                      <Clock size={11} /> {timeAgo(c.updatedAt)}
                    </span>
                  </div>
                  <p className="text-xs mt-1.5 truncate" style={{ color: 'var(--ink-soft)' }}>
                    {msgPreview(last)}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusDot status={c.status} />
                    {c.currentNodeId && nodeCounts.get(c.currentNodeId) && (
                      <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                        · {nodeCounts.get(c.currentNodeId)!.label}
                      </span>
                    )}
                  </div>
                </MkCard>
              )
            })}
          </div>

          {/* chat */}
          <div className="lg:col-span-2">
            <MkCard style={{ padding: 0, overflow: 'hidden' }}>
              {!conv ? (
                <div className="flex flex-col items-center justify-center" style={{ height: '72vh', color: 'var(--muted)' }}>
                  <MessageCircle size={32} strokeWidth={1.3} style={{ opacity: 0.4, marginBottom: 12 }} />
                  <p className="text-sm">Selecione uma conversa ao lado</p>
                </div>
              ) : (
                <div className="flex flex-col" style={{ height: '72vh' }}>
                  {/* header */}
                  <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                    <div>
                      <p className="mk-display font-semibold text-sm">{conv.phoneNumber}</p>
                      <span className="inline-flex items-center gap-2">
                        <StatusDot status={conv.status} />
                        {currentNode && (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>· etapa: {currentNode.label}</span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                    {deliverables.available && (
                      <button onClick={deliverNow} disabled={delivering}
                        className="inline-flex items-center gap-2 rounded-full text-xs font-semibold transition-all disabled:opacity-50"
                        style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '7px 15px' }}>
                        <Gift size={12} /> {delivering ? 'Entregando…' : 'Entregar produto'}
                      </button>
                    )}
                    {conv.status !== 'ended' && (
                    <button onClick={togglePause}
                      className="inline-flex items-center gap-2 rounded-full text-xs font-semibold transition-all"
                      style={paused
                        ? { background: 'var(--ink)', color: 'var(--paper)', padding: '8px 16px' }
                        : { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '7px 15px' }}>
                      {paused ? <><Play size={12} /> Devolver pro bot</> : <><Pause size={12} /> Assumir conversa</>}
                    </button>
                    )}
                    </div>
                  </div>

                  {/* controle do funil: escolhe a etapa e dispara o flow dali (voltar/adiantar) */}
                  {nodes.length > 0 && (() => {
                    const selValue = gotoSel ?? (nodes.some(nd => nd.id === conv.currentNodeId) ? conv.currentNodeId! : '')
                    return (
                      <div className="flex items-center gap-2 px-5 py-2.5" style={{ borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                        <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>Funil</span>
                        <select
                          className="mk-input flex-1 text-xs"
                          style={{ padding: '6px 10px', minWidth: 0 }}
                          value={selValue}
                          onChange={e => setGotoSel(e.target.value)}
                        >
                          {selValue === '' && <option value="" disabled>— etapa do funil —</option>}
                          {nodes.map(nd => (
                            <option key={nd.id} value={nd.id}>
                              {(nd.id === conv.currentNodeId ? '● ' : '') + nd.label}
                            </option>
                          ))}
                        </select>
                        <button onClick={fireGoto} disabled={firing || !selValue}
                          className="inline-flex items-center gap-2 rounded-full text-xs font-semibold transition-all disabled:opacity-50 shrink-0"
                          style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '7px 15px' }}>
                          <SkipForward size={12} /> {firing ? 'Disparando…' : 'Disparar daqui'}
                        </button>
                      </div>
                    )
                  })()}

                  {/* mensagens */}
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ background: 'var(--paper)' }}>
                    {conv.history.map((m, i) => {
                      const bot = m.role === 'assistant'
                      const text = m.content && !(m.media && m.content === '[image]') ? m.content : ''
                      return (
                        <div key={i} className={`flex flex-col ${bot ? 'items-end' : 'items-start'}`}>
                          <div className="max-w-[76%] text-sm"
                            style={bot
                              ? { background: 'var(--ink)', color: 'var(--paper)', padding: '9px 14px', borderRadius: '14px 14px 4px 14px', boxShadow: '0 2px 8px rgba(10,10,10,.08)' }
                              : { background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '9px 14px', borderRadius: '14px 14px 14px 4px' }}>
                            {m.media?.type === 'image' && (m.media.url
                              ? <a href={m.media.url} target="_blank" rel="noreferrer">
                                  <img src={m.media.url} alt="" style={{ maxWidth: 220, borderRadius: 10, display: 'block', marginBottom: text ? 8 : 0 }} />
                                </a>
                              : <span style={{ opacity: 0.9 }}>📷 Imagem recebida{text ? '' : ' (abrir no WhatsApp)'}</span>)}
                            {m.media?.type === 'video' && m.media.url && (
                              <video src={m.media.url} controls preload="metadata"
                                style={{ maxWidth: 220, borderRadius: 10, display: 'block', marginBottom: text ? 8 : 0 }} />
                            )}
                            {m.media?.type === 'audio' && (m.media.url
                              ? <audio src={m.media.url} controls preload="metadata" style={{ width: 240, display: 'block' }} />
                              : <span style={{ opacity: 0.9 }}>🎙️ Áudio recebido</span>)}
                            {m.media?.type === 'document' && (
                              m.media.url
                                ? <a href={m.media.url} target="_blank" rel="noreferrer"
                                    style={{ color: 'inherit', textDecoration: 'underline' }}>📄 {m.media.filename ?? 'documento'}</a>
                                : <span>📄 {m.media.filename ?? 'documento'}</span>
                            )}
                            {text && <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: waHtml(text) }} />}
                          </div>
                          <span className="text-[10px] mt-1 px-1" style={{ color: 'var(--muted)' }}>{fmtTime(m.timestamp)}</span>
                        </div>
                      )
                    })}
                    <div ref={chatEndRef} />
                  </div>

                  {/* composer */}
                  <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                    <input
                      className="mk-input flex-1 px-4 py-2.5 text-sm"
                      placeholder={paused ? 'Você está no controle — escreva pro lead…' : 'Mensagem manual (o funil continua ativo)…'}
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendManual() } }}
                    />
                    <button onClick={sendManual} disabled={sending || !draft.trim()}
                      className="inline-flex items-center gap-2 rounded-full text-sm font-semibold transition-all disabled:opacity-40"
                      style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '10px 18px' }}>
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
