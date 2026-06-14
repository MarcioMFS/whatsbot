import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import gsap from 'gsap'
import {
  Plus, ExternalLink, QrCode, Power, PowerOff, Loader2, Users, GitBranch,
  Trash2, Settings2, Activity, Package, ShoppingBag, Tag, PhoneCall, CreditCard,
  ChevronRight, ArrowRight, Bot, Workflow, Copy,
} from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, MkButton, MkField, MkTextarea, MkSwitch, Eyebrow } from '../components/mkhub'
import { api } from '../api/client.ts'
import { useUIStore } from '../stores/uiStore.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutingRule { tag: string; flowId: string }

interface GlobalConfig {
  defaultPixKey?: string
  defaultReceiverName?: string
  ownerPhone?: string
  supportFlowId?: string
  defaultCurrency?: string
  defaultPaymentExpirationMinutes?: number
  assistantIdentityMode?: 'named' | 'brand_only'
  assistantName?: string
  companyName?: string
  agentKnowledge?: string
  neverExposeAI?: boolean
  ownerTestMode?: boolean
  tone?: 'acolhedor' | 'profissional' | 'casual' | 'formal'
  locale?: 'pt-BR' | 'en-US' | 'es-ES'
}

interface BotData {
  id: string
  name: string
  isActive: boolean
  activeFlowId: string | null
  routingRules: RoutingRule[]
  globalConfig: GlobalConfig
  productInfo: { name: string; description: string; persona: string; language: string }
  aiConfig: { provider: string; model: string; temperature: number }
  evolutionConfig: { instanceName: string }
}

interface FlowData {
  id: string
  name: string
  nodes: unknown[]
  edges: unknown[]
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'automacao',    label: 'Automação',    icon: GitBranch  },
  { id: 'operacao',     label: 'Operação',     icon: Activity   },
  { id: 'catalogo',     label: 'Catálogo',     icon: Package    },
  { id: 'financeiro',   label: 'Financeiro',   icon: CreditCard },
  { id: 'configuracoes',label: 'Configurações',icon: Settings2  },
] as const

type TabId = typeof TABS[number]['id']

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BotConfig() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { setCurrentBot } = useUIStore()

  const activeTab: TabId = (searchParams.get('tab') as TabId) ?? 'automacao'

  const [bot, setBot] = useState<BotData | null>(null)
  const [flows, setFlows] = useState<FlowData[]>([])
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [showQR, setShowQR] = useState(false)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')
  const [waState, setWaState] = useState<'open' | 'connecting' | 'close' | null>(null)
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([])
  const [routingSaving, setRoutingSaving] = useState(false)
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>({})
  const [configSaving, setConfigSaving] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!botId) return
    Promise.all([
      api.bots.get(botId),
      api.flows.list(botId),
      api.bots.connectionStatus(botId),
    ]).then(([b, f, s]) => {
      const botData = b as BotData
      setBot(botData)
      setCurrentBot({ id: botData.id, name: botData.name })
      setRoutingRules(botData.routingRules ?? [])
      setGlobalConfig(botData.globalConfig ?? {})
      setFlows(f as FlowData[])
      setWaState((s as { state: 'open' | 'connecting' | 'close' }).state)
    })
    if (headingRef.current) {
      gsap.fromTo(headingRef.current, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' })
    }
  }, [botId])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { setCurrentBot(null) }, [botId])

  useEffect(() => {
    if (!botId) return
    const interval = setInterval(async () => {
      try {
        const s = await api.bots.connectionStatus(botId)
        const state = (s as { state: 'open' | 'connecting' | 'close' }).state
        setWaState(state)
        if (state === 'open') setShowQR(false)
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [botId])

  const setTab = (tab: TabId) => setSearchParams({ tab })

  const createFlow = async () => {
    if (!botId) return
    const name = prompt('Nome do fluxo:')
    if (!name) return
    const flow = await api.flows.create(botId, { name, nodes: [], edges: [] }) as FlowData
    setFlows(f => [...f, flow])
  }

  // A1: clone an existing flow (nodes + edges) as a starting template
  const cloneFlow = async (src: FlowData) => {
    if (!botId) return
    const name = prompt('Nome do novo fluxo:', `Cópia de ${src.name}`)
    if (!name?.trim()) return
    const flow = await api.flows.create(botId, { name: name.trim(), nodes: src.nodes, edges: src.edges }) as FlowData
    setFlows(f => [...f, flow])
  }

  const loadQR = async () => {
    if (!botId) return
    setQrLoading(true)
    setQrError('')
    try {
      const { qrCode: qr } = await api.bots.qrcode(botId)
      if (!qr) {
        setQrError('QR code ainda não disponível. Aguarde alguns segundos e tente novamente.')
      } else {
        setQrCode(qr)
        setShowQR(true)
        setWaState('connecting')
      }
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Falha ao carregar QR code')
    } finally {
      setQrLoading(false)
    }
  }

  const toggleActive = async (flowId: string) => {
    if (!botId || !bot) return
    const updated = (bot.isActive && bot.activeFlowId === flowId)
      ? await api.bots.deactivate(botId) as BotData
      : await api.bots.activate(botId, flowId) as BotData
    setBot(updated)
  }

  const saveConfig = async () => {
    if (!botId) return
    setConfigSaving(true)
    try { await api.bots.updateConfig(botId, globalConfig as Record<string, unknown>) }
    finally { setConfigSaving(false) }
  }

  const saveRouting = async () => {
    if (!botId) return
    setRoutingSaving(true)
    try { await api.bots.updateRoutingRules(botId, routingRules) }
    finally { setRoutingSaving(false) }
  }

  if (!bot) return null

  return (
    <MkLayout>
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div style={{ width: 40, height: 40, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bot size={18} strokeWidth={1.6} />
          </div>
          <div className="flex-1">
            <h1 ref={headingRef} className="mk-display" style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{bot.name}</h1>
            <p style={{ color: 'var(--muted)', fontSize: '.8rem', marginTop: 2 }}>{bot.productInfo.name}</p>
          </div>
          <span className="text-xs font-semibold" style={bot.isActive
            ? { background: 'var(--ink)', color: 'var(--paper)', padding: '5px 14px', borderRadius: 999 }
            : { border: '1px solid var(--line)', color: 'var(--muted)', padding: '4px 13px', borderRadius: 999 }}>
            {bot.isActive ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        {/* Top cards */}
        <div className="grid grid-cols-2 gap-5 mb-8">
          <MkCard style={{ padding: 22 }}>
            <Eyebrow className="block mb-4">Configuração do Bot</Eyebrow>
            <dl className="space-y-2.5 text-sm">
              <Row label="Provedor IA" value={bot.aiConfig.provider} />
              <Row label="Modelo" value={bot.aiConfig.model} />
              <Row label="Temperatura" value={String(bot.aiConfig.temperature)} />
              <Row label="Instância" value={bot.evolutionConfig.instanceName} />
              <Row label="Idioma" value={bot.productInfo.language} />
            </dl>
          </MkCard>

          <MkCard style={{ padding: 22 }}>
            <Eyebrow className="block mb-4">Conexão WhatsApp</Eyebrow>
            <div className="flex items-center gap-2 mb-4">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: waState === 'open' ? '#22a06b' : waState === 'connecting' ? '#d9a300' : '#bcbcb8' }} className={waState === 'connecting' ? 'animate-pulse' : ''} />
              <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>
                {waState === 'open' ? 'Conectado' : waState === 'connecting' ? 'Conectando...' : waState === 'close' ? 'Desconectado' : '—'}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {waState === 'open' ? (
                <div className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl" style={{ background: 'rgba(34,160,107,0.08)', border: '1px solid rgba(34,160,107,0.2)', color: '#1d7a52' }}>
                  <QrCode size={16} /> WhatsApp conectado
                </div>
              ) : (
                <button onClick={loadQR} disabled={qrLoading}
                  className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl transition-all"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--paper-2)' }}>
                  {qrLoading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                  Mostrar QR Code
                </button>
              )}
              <a href="https://evolution.whatsbot.mfslabs.com.br/manager" target="_blank" rel="noreferrer"
                className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl transition-all"
                style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>
                <ExternalLink size={14} /> Evolution Manager
              </a>
            </div>
            {qrError && (
              <div className="mt-3 text-xs rounded-lg px-3 py-2.5" style={{ background: 'rgba(217,163,0,0.08)', border: '1px solid rgba(217,163,0,0.2)', color: '#9a7400' }}>
                <p>{qrError}</p>
                <p style={{ color: 'var(--muted)', marginTop: 4 }}>Instância: <span className="font-mono" style={{ color: 'var(--ink-soft)' }}>{bot.evolutionConfig.instanceName}</span></p>
              </div>
            )}
            {showQR && qrCode && waState !== 'open' && (
              <div className="mt-4 p-3 bg-white rounded-xl inline-block" style={{ border: '1px solid var(--line)' }}>
                <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-40 h-40" />
              </div>
            )}
          </MkCard>
        </div>

        {/* Tab bar — editorial underline */}
        <div className="flex gap-7 mb-8" style={{ borderBottom: '1px solid var(--line)' }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button key={tab.id} onClick={() => setTab(tab.id)}
                className="flex items-center gap-2 pb-3 text-sm transition-colors"
                style={{ color: active ? 'var(--ink)' : 'var(--muted)', fontWeight: active ? 600 : 500, borderBottom: active ? '2px solid var(--ink)' : '2px solid transparent', marginBottom: -1 }}>
                <tab.icon size={14} strokeWidth={1.8} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'automacao' && (
          <AutomacaoTab bot={bot} flows={flows} botId={botId!} navigate={navigate} createFlow={createFlow} cloneFlow={cloneFlow} toggleActive={toggleActive} />
        )}

        {activeTab === 'operacao' && (
          <NavCardsTab botId={botId!} navigate={navigate} cards={[
            { label: 'Leads', desc: 'Perfis de contatos, tags e histórico de sessões', icon: Users, path: 'leads' },
            { label: 'Pedidos', desc: 'Pedidos gerados pelos flows de venda', icon: ShoppingBag, path: 'orders' },
            { label: 'Handoffs', desc: 'Conversas escaladas para atendimento humano', icon: PhoneCall, path: 'handoffs' },
          ]} />
        )}

        {activeTab === 'catalogo' && (
          <NavCardsTab botId={botId!} navigate={navigate} cards={[
            { label: 'Produtos', desc: 'Catálogo com aliases para busca fuzzy e links de acesso', icon: Package, path: 'products' },
            { label: 'Pacotes', desc: 'Pricing por quantidade — mínimo ou exato', icon: Tag, path: 'package-offers' },
            { label: 'Capabilities', desc: 'Sub-flows que a IA invoca dinamicamente por contexto', icon: Workflow, path: 'capabilities' },
            { label: 'AI Patterns', desc: 'Decisões do roteador de IA, taxa de fallback e desfechos', icon: Activity, path: 'patterns' },
          ]} />
        )}

        {activeTab === 'financeiro' && (
          <NavCardsTab botId={botId!} navigate={navigate} cards={[
            { label: 'Pagamentos', desc: 'PaymentIntents gerados, status e cancelamentos', icon: CreditCard, path: 'payment-intents' },
            { label: 'Eventos', desc: 'Log de eventos da conversa em tempo real', icon: Activity, path: 'events' },
          ]} />
        )}

        {activeTab === 'configuracoes' && (
          <ConfigTab flows={flows} globalConfig={globalConfig} setGlobalConfig={setGlobalConfig} configSaving={configSaving} saveConfig={saveConfig} routingRules={routingRules} setRoutingRules={setRoutingRules} routingSaving={routingSaving} saveRouting={saveRouting} />
        )}

      </div>
    </MkLayout>
  )
}

// ─── Tab: Automação ───────────────────────────────────────────────────────────

function AutomacaoTab({
  bot, flows, botId, navigate, createFlow, cloneFlow, toggleActive,
}: {
  bot: BotData; flows: FlowData[]; botId: string
  navigate: (path: string) => void; createFlow: () => void
  cloneFlow: (src: FlowData) => void; toggleActive: (flowId: string) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="mk-display" style={{ fontSize: '1.15rem', fontWeight: 600 }}>Flows de Conversa</h2>
          <p style={{ color: 'var(--muted)', fontSize: '.8rem', marginTop: 2 }}>Crie e ative fluxos de automação para este bot</p>
        </div>
        <MkButton onClick={createFlow} variant="ghost"><Plus size={14} /> Novo Flow</MkButton>
      </div>

      {flows.length === 0 ? (
        <MkCard style={{ padding: '56px 32px', textAlign: 'center' }}>
          <GitBranch size={26} strokeWidth={1.4} style={{ margin: '0 auto 12px', color: 'var(--muted)' }} />
          <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem' }}>Nenhum flow criado ainda.</p>
          <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: 4, marginBottom: 18 }}>Crie um flow para começar a automatizar conversas.</p>
          <MkButton onClick={createFlow}>Criar primeiro flow</MkButton>
        </MkCard>
      ) : (
        <div className="space-y-3">
          {flows.map(flow => {
            const isActive = bot.isActive && bot.activeFlowId === flow.id
            return (
              <MkCard key={flow.id} style={{ padding: 18 }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? '#22a06b' : '#cfcfca' }} />
                    <div>
                      <p className="mk-display" style={{ fontWeight: 600, fontSize: '.95rem' }}>{flow.name}</p>
                      <p style={{ color: 'var(--muted)', fontSize: '.75rem', marginTop: 2 }}>
                        {(flow.nodes as unknown[]).length} nós · {(flow.edges as unknown[]).length} conexões
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <GhostBtn onClick={() => toggleActive(flow.id)} active={isActive}>
                      {isActive ? <><PowerOff size={12} /> Desativar</> : <><Power size={12} /> Ativar</>}
                    </GhostBtn>
                    <GhostBtn onClick={() => cloneFlow(flow)} title="Duplicar este flow"><Copy size={12} /> Clonar</GhostBtn>
                    <GhostBtn onClick={() => navigate(`/bots/${botId}/flow/${flow.id}`)}><ExternalLink size={12} /> Editar</GhostBtn>
                  </div>
                </div>
              </MkCard>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Nav Cards (monochrome) ──────────────────────────────────────────────

function NavCardsTab({
  botId, navigate, cards,
}: {
  botId: string
  navigate: (path: string) => void
  cards: Array<{ label: string; desc: string; icon: React.ElementType; path: string }>
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {cards.map(card => (
        <MkCard key={card.path} hover onClick={() => navigate(`/bots/${botId}/${card.path}`)} style={{ padding: 20 }}>
          <div className="flex items-center gap-4">
            <div style={{ width: 42, height: 42, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <card.icon size={18} strokeWidth={1.6} />
            </div>
            <div className="flex-1">
              <p className="mk-display" style={{ fontWeight: 600, fontSize: '.95rem' }}>{card.label}</p>
              <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: 2 }}>{card.desc}</p>
            </div>
            <ArrowRight size={16} strokeWidth={1.6} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          </div>
        </MkCard>
      ))}
    </div>
  )
}

// ─── Tab: Configurações ───────────────────────────────────────────────────────

function ConfigTab({
  flows, globalConfig, setGlobalConfig, configSaving, saveConfig,
  routingRules, setRoutingRules, routingSaving, saveRouting,
}: {
  flows: FlowData[]
  globalConfig: GlobalConfig
  setGlobalConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>
  configSaving: boolean
  saveConfig: () => void
  routingRules: RoutingRule[]
  setRoutingRules: React.Dispatch<React.SetStateAction<RoutingRule[]>>
  routingSaving: boolean
  saveRouting: () => void
}) {
  const set = (k: keyof GlobalConfig, v: unknown) => setGlobalConfig(c => ({ ...c, [k]: v }))

  return (
    <div className="space-y-9">
      {/* Pagamentos */}
      <ConfigSection title="Pagamentos" subtitle="Dados Pix e expiração usados pelos nós de checkout">
        <div className="grid grid-cols-2 gap-5">
          <MkField label="Chave Pix padrão" value={globalConfig.defaultPixKey ?? ''} onChange={v => set('defaultPixKey', v)} placeholder="email@exemplo.com" />
          <MkField label="Nome do favorecido" value={globalConfig.defaultReceiverName ?? ''} onChange={v => set('defaultReceiverName', v)} placeholder="João Silva" />
          <MkField label="Telefone do dono do bot" value={globalConfig.ownerPhone ?? ''} onChange={v => set('ownerPhone', v)} placeholder="5511999999999" />
          <ToggleRow on={!!globalConfig.ownerTestMode} onChange={() => set('ownerTestMode', !globalConfig.ownerTestMode)}
            title="Modo teste (dono)" desc={globalConfig.ownerTestMode ? 'Dono pode testar o fluxo' : 'Mensagens do dono ignoradas'} />
          <MkSelect label="Fluxo de suporte pós-compra" value={globalConfig.supportFlowId ?? ''} onChange={v => set('supportFlowId', v || undefined)}>
            <option value="">Nenhum</option>
            {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </MkSelect>
          <MkSelect label="Moeda padrão" value={globalConfig.defaultCurrency ?? 'BRL'} onChange={v => set('defaultCurrency', v)}>
            <option value="BRL">BRL — Real</option>
            <option value="USD">USD — Dólar</option>
            <option value="EUR">EUR — Euro</option>
          </MkSelect>
          <div>
            <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Expiração de pagamento (min)</label>
            <input type="number" min={5} max={1440} value={globalConfig.defaultPaymentExpirationMinutes ?? 60}
              onChange={e => set('defaultPaymentExpirationMinutes', Number(e.target.value))}
              className="mk-input w-full px-3 py-2.5 text-sm" />
          </div>
        </div>
      </ConfigSection>

      {/* Persona */}
      <ConfigSection title="Persona & Identidade" subtitle="Como o bot se apresenta nas conversas">
        <div className="grid grid-cols-2 gap-5">
          <MkSelect label="Modo de identidade" value={globalConfig.assistantIdentityMode ?? 'brand_only'} onChange={v => set('assistantIdentityMode', v)}>
            <option value="brand_only">Só marca (sem nome)</option>
            <option value="named">Com nome (ex: Bia)</option>
          </MkSelect>
          <MkField label="Nome do assistente" value={globalConfig.assistantName ?? ''} onChange={v => set('assistantName', v)} placeholder="Bia" />
          <MkField label="Nome da empresa" value={globalConfig.companyName ?? ''} onChange={v => set('companyName', v)} placeholder="DramaHub" />
          <MkSelect label="Tom de voz" value={globalConfig.tone ?? 'acolhedor'} onChange={v => set('tone', v)}>
            <option value="acolhedor">Acolhedor — emojis, diminutivos</option>
            <option value="casual">Casual — gírias leves, direto</option>
            <option value="profissional">Profissional — sem gírias</option>
            <option value="formal">Formal — sem emojis</option>
          </MkSelect>
          <MkSelect label="Idioma" value={globalConfig.locale ?? 'pt-BR'} onChange={v => set('locale', v)}>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English (US)</option>
            <option value="es-ES">Español</option>
          </MkSelect>
          <ToggleRow on={globalConfig.neverExposeAI !== false} onChange={() => set('neverExposeAI', !(globalConfig.neverExposeAI !== false))}
            title="Nunca revelar que é IA" desc={globalConfig.neverExposeAI === false ? 'Pode revelar se perguntado' : 'Sempre nega ser IA'} />
        </div>
      </ConfigSection>

      {/* Conhecimento do agente */}
      <ConfigSection title="O que o bot sabe" subtitle="Fatos que o bot pode usar como verdade — ele só afirma o que está aqui, não inventa">
        <MkTextarea
          label="Conhecimento (link do catálogo, entrega, garantia…)"
          value={globalConfig.agentKnowledge ?? ''}
          onChange={v => set('agentKnowledge', v)}
          rows={6}
          placeholder={'Ex:\n- Catálogo completo: https://...\n- Entrega: acesso na hora, por aqui mesmo\n- Garantia: 7 dias'}
          hint="Um fato por linha. O bot usa isso como única fonte de verdade: envia o link quando faz sentido e, se algo não estiver aqui, ele não inventa que “não existe” — guia a pessoa de outro jeito."
        />
      </ConfigSection>

      <MkButton onClick={saveConfig} disabled={configSaving}>
        {configSaving ? <Loader2 size={14} className="animate-spin" /> : null} Salvar configurações
      </MkButton>

      {/* Roteamento */}
      <ConfigSection title="Roteamento por Tag" subtitle="Lead com tag → redireciona para flow específico. Ordem importa.">
        <div className="space-y-2">
          {routingRules.length === 0 && (
            <p className="text-xs py-4 text-center rounded-xl" style={{ color: 'var(--muted)', background: 'var(--paper)', border: '1px solid var(--line)' }}>Nenhuma regra. Sempre usa o flow ativo padrão.</p>
          )}
          {routingRules.map((rule, i) => (
            <div key={i} className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
              <span className="text-xs w-4 text-center" style={{ color: 'var(--muted)' }}>{i + 1}</span>
              <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>Tag</span>
              <input value={rule.tag} onChange={e => setRoutingRules(r => r.map((x, j) => j === i ? { ...x, tag: e.target.value } : x))} placeholder="buyer"
                className="mk-input text-xs px-2 py-1.5 w-28" />
              <ChevronRight size={12} strokeWidth={1.8} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <select value={rule.flowId} onChange={e => setRoutingRules(r => r.map((x, j) => j === i ? { ...x, flowId: e.target.value } : x))}
                className="mk-input text-xs px-2 py-1.5 flex-1">
                <option value="">Selecionar flow...</option>
                {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button onClick={() => setRoutingRules(r => r.filter((_, j) => j !== i))} style={{ color: 'var(--muted)' }} className="hover:opacity-60">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <MkButton variant="ghost" onClick={() => setRoutingRules(r => [...r, { tag: '', flowId: '' }])}><Plus size={12} /> Adicionar regra</MkButton>
          <MkButton onClick={saveRouting} disabled={routingSaving}>
            {routingSaving ? <Loader2 size={12} className="animate-spin" /> : null} Salvar regras
          </MkButton>
        </div>
      </ConfigSection>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function GhostBtn({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
      style={active
        ? { background: 'var(--ink)', color: 'var(--paper)' }
        : { border: '1px solid var(--line)', color: 'var(--ink-soft)', background: 'var(--paper-2)' }}>
      {children}
    </button>
  )
}

function ConfigSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="mk-display" style={{ fontSize: '1.05rem', fontWeight: 600 }}>{title}</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: 2 }}>{subtitle}</p>
      </div>
      <MkCard style={{ padding: 22 }}>{children}</MkCard>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="font-medium" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  )
}

function ToggleRow({ on, onChange, title, desc }: { on: boolean; onChange: () => void; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 pt-5">
      <MkSwitch on={on} onChange={onChange} label={title} />
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{title}</p>
        <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{desc}</p>
      </div>
    </div>
  )
}

function MkSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="mk-input w-full px-3 py-2.5 text-sm">
        {children}
      </select>
    </div>
  )
}
