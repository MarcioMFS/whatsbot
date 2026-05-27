import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import gsap from 'gsap'
import {
  Plus, ExternalLink, QrCode, Power, PowerOff, Loader2, Users, GitBranch,
  Trash2, Settings2, Activity, Package, ShoppingBag, Tag, PhoneCall, CreditCard,
  ChevronRight, ArrowRight, Bot,
} from 'lucide-react'
import { Layout } from '../components/ui/Layout.tsx'
import { GlassCard } from '../components/ui/GlassCard.tsx'
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
      gsap.fromTo(headingRef.current, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' })
    }
  }, [botId])

  // Limpa bot do store ao sair
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { setCurrentBot(null) }, [botId])

  // Poll WA status
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
    <Layout>
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
            <Bot size={16} className="text-brand-400" />
          </div>
          <div className="flex-1">
            <h1 ref={headingRef} className="text-xl font-bold text-white">{bot.name}</h1>
            <p className="text-slate-500 text-xs mt-0.5">{bot.productInfo.name}</p>
          </div>
          <span className={`text-xs font-medium px-3 py-1 rounded-full border ${
            bot.isActive
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
          }`}>
            {bot.isActive ? '● Ativo' : '○ Inativo'}
          </span>
        </div>

        {/* Top cards: sempre visíveis */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <GlassCard animate delay={0}>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Configuração do Bot</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Provedor IA" value={bot.aiConfig.provider} />
              <Row label="Modelo" value={bot.aiConfig.model} />
              <Row label="Temperatura" value={String(bot.aiConfig.temperature)} />
              <Row label="Instância" value={bot.evolutionConfig.instanceName} />
              <Row label="Idioma" value={bot.productInfo.language} />
            </dl>
          </GlassCard>

          <GlassCard animate delay={0.08}>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Conexão WhatsApp</h3>
            <div className="flex items-center gap-2 mb-4">
              <span className={`w-2 h-2 rounded-full ${
                waState === 'open' ? 'bg-emerald-400' :
                waState === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'
              }`} />
              <span className="text-sm text-slate-400">
                {waState === 'open' ? 'Conectado' :
                 waState === 'connecting' ? 'Conectando...' :
                 waState === 'close' ? 'Desconectado' : '—'}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {waState === 'open' ? (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm px-4 py-2.5 rounded-xl">
                  <QrCode size={16} /> WhatsApp conectado
                </div>
              ) : (
                <button onClick={loadQR} disabled={qrLoading}
                  className="flex items-center gap-2 bg-glass-200 hover:bg-glass-300 disabled:opacity-50 border border-glass-border text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-all">
                  {qrLoading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                  Mostrar QR Code
                </button>
              )}
              <a href="https://evolution.whatsbot.mfslabs.com.br/manager" target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-glass-100 hover:bg-glass-200 border border-glass-border text-slate-300 hover:text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-all">
                <ExternalLink size={14} /> Evolution Manager
              </a>
            </div>
            {qrError && (
              <div className="mt-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
                <p>{qrError}</p>
                <p className="text-slate-500 mt-1">Instância: <span className="font-mono text-slate-300">{bot.evolutionConfig.instanceName}</span></p>
              </div>
            )}
            {showQR && qrCode && waState !== 'open' && (
              <div className="mt-4 p-3 bg-white rounded-xl inline-block">
                <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-40 h-40" />
              </div>
            )}
          </GlassCard>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 bg-glass-100 border border-glass-border rounded-2xl">
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium transition-all duration-200 ${
                  active
                    ? 'bg-brand-500 text-white shadow-glow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-glass-200'
                }`}
              >
                <tab.icon size={13} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'automacao' && (
          <AutomacaoTab
            bot={bot}
            flows={flows}
            botId={botId!}
            navigate={navigate}
            createFlow={createFlow}
            toggleActive={toggleActive}
          />
        )}

        {activeTab === 'operacao' && (
          <NavCardsTab
            botId={botId!}
            navigate={navigate}
            cards={[
              { label: 'Leads', desc: 'Perfis de contatos, tags e histórico de sessões', icon: Users, color: 'purple', path: 'leads' },
              { label: 'Pedidos', desc: 'Pedidos gerados pelos flows de venda', icon: ShoppingBag, color: 'lime', path: 'orders' },
              { label: 'Handoffs', desc: 'Conversas escaladas para atendimento humano', icon: PhoneCall, color: 'red', path: 'handoffs' },
            ]}
          />
        )}

        {activeTab === 'catalogo' && (
          <NavCardsTab
            botId={botId!}
            navigate={navigate}
            cards={[
              { label: 'Produtos', desc: 'Catálogo com aliases para busca fuzzy e links de acesso', icon: Package, color: 'indigo', path: 'products' },
              { label: 'Pacotes', desc: 'Pricing por quantidade — mínimo ou exato', icon: Tag, color: 'orange', path: 'package-offers' },
            ]}
          />
        )}

        {activeTab === 'financeiro' && (
          <NavCardsTab
            botId={botId!}
            navigate={navigate}
            cards={[
              { label: 'Pagamentos', desc: 'PaymentIntents gerados, status e cancelamentos', icon: CreditCard, color: 'brand', path: 'payment-intents' },
              { label: 'Eventos', desc: 'Log de eventos da conversa em tempo real', icon: Activity, color: 'amber', path: 'events' },
            ]}
          />
        )}

        {activeTab === 'configuracoes' && (
          <ConfigTab
            flows={flows}
            globalConfig={globalConfig}
            setGlobalConfig={setGlobalConfig}
            configSaving={configSaving}
            saveConfig={saveConfig}
            routingRules={routingRules}
            setRoutingRules={setRoutingRules}
            routingSaving={routingSaving}
            saveRouting={saveRouting}
          />
        )}

      </div>
    </Layout>
  )
}

// ─── Tab: Automação ───────────────────────────────────────────────────────────

function AutomacaoTab({
  bot, flows, botId, navigate, createFlow, toggleActive,
}: {
  bot: BotData
  flows: FlowData[]
  botId: string
  navigate: (path: string) => void
  createFlow: () => void
  toggleActive: (flowId: string) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Flows de Conversa</h2>
          <p className="text-xs text-slate-500 mt-0.5">Crie e ative fluxos de automação para este bot</p>
        </div>
        <button onClick={createFlow}
          className="flex items-center gap-2 bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/30 text-brand-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
          <Plus size={14} /> Novo Flow
        </button>
      </div>

      {flows.length === 0 ? (
        <div className="glass text-center py-14 px-8">
          <GitBranch size={28} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Nenhum flow criado ainda.</p>
          <p className="text-slate-600 text-xs mt-1">Crie um flow para começar a automatizar conversas.</p>
          <button onClick={createFlow}
            className="mt-4 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-5 py-2 rounded-xl transition-all">
            Criar primeiro flow
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {flows.map((flow, i) => {
            const isActive = bot.isActive && bot.activeFlowId === flow.id
            return (
              <GlassCard key={flow.id} animate delay={0.05 + i * 0.05}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <div>
                      <p className="font-medium text-white text-sm">{flow.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {(flow.nodes as unknown[]).length} nós · {(flow.edges as unknown[]).length} conexões
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleActive(flow.id)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
                          : 'bg-glass-100 text-slate-400 border-glass-border hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30'
                      }`}>
                      {isActive ? <><PowerOff size={12} />Desativar</> : <><Power size={12} />Ativar</>}
                    </button>
                    <button onClick={() => navigate(`/bots/${botId}/flow/${flow.id}`)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-glass-100 border border-glass-border text-slate-300 hover:text-white hover:bg-glass-200 transition-all">
                      <ExternalLink size={12} /> Editar
                    </button>
                  </div>
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Nav Cards (Operação / Catálogo / Financeiro) ────────────────────────

type CardColor = 'purple' | 'lime' | 'red' | 'indigo' | 'orange' | 'brand' | 'amber'

const COLOR_MAP: Record<CardColor, { bg: string; border: string; icon: string; arrow: string }> = {
  purple: { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  icon: 'text-purple-400',  arrow: 'text-purple-400' },
  lime:   { bg: 'bg-lime-500/10',    border: 'border-lime-500/20',    icon: 'text-lime-400',    arrow: 'text-lime-400'   },
  red:    { bg: 'bg-red-500/10',     border: 'border-red-500/20',     icon: 'text-red-400',     arrow: 'text-red-400'    },
  indigo: { bg: 'bg-indigo-500/10',  border: 'border-indigo-500/20',  icon: 'text-indigo-400',  arrow: 'text-indigo-400' },
  orange: { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  icon: 'text-orange-400',  arrow: 'text-orange-400' },
  brand:  { bg: 'bg-brand-500/10',   border: 'border-brand-500/20',   icon: 'text-brand-400',   arrow: 'text-brand-400'  },
  amber:  { bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   icon: 'text-amber-400',   arrow: 'text-amber-400'  },
}

function NavCardsTab({
  botId, navigate, cards,
}: {
  botId: string
  navigate: (path: string) => void
  cards: Array<{ label: string; desc: string; icon: React.ElementType; color: CardColor; path: string }>
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {cards.map((card, i) => {
        const c = COLOR_MAP[card.color]
        return (
          <GlassCard
            key={card.path}
            animate
            delay={0.05 + i * 0.06}
            onClick={() => navigate(`/bots/${botId}/${card.path}`)}
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center shrink-0`}>
                <card.icon size={18} className={c.icon} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-white text-sm">{card.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{card.desc}</p>
              </div>
              <ArrowRight size={16} className={`${c.arrow} shrink-0 opacity-60`} />
            </div>
          </GlassCard>
        )
      })}
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
    <div className="space-y-8">

      {/* Pagamentos */}
      <ConfigSection title="Pagamentos" subtitle="Dados Pix e expiração usados pelos nós de checkout">
        <div className="grid grid-cols-2 gap-4">
          <ConfigField label="Chave Pix padrão" value={globalConfig.defaultPixKey ?? ''} onChange={v => set('defaultPixKey', v)} placeholder="email@exemplo.com" />
          <ConfigField label="Nome do favorecido" value={globalConfig.defaultReceiverName ?? ''} onChange={v => set('defaultReceiverName', v)} placeholder="João Silva" />
          <ConfigField label="Telefone do dono do bot" value={globalConfig.ownerPhone ?? ''} onChange={v => set('ownerPhone', v)} placeholder="5511999999999" />
          <div className="flex items-center gap-3 pt-5">
            <button
              onClick={() => set('ownerTestMode', !globalConfig.ownerTestMode)}
              className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
                globalConfig.ownerTestMode ? 'bg-brand-500' : 'bg-slate-700'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                globalConfig.ownerTestMode ? 'translate-x-5' : ''
              }`} />
            </button>
            <div>
              <p className="text-xs font-medium text-slate-300">Modo teste (dono)</p>
              <p className="text-[10px] text-slate-600">
                {globalConfig.ownerTestMode ? 'Dono pode testar o fluxo' : 'Mensagens do dono ignoradas'}
              </p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Fluxo de suporte pós-compra</label>
            <select
              value={globalConfig.supportFlowId ?? ''}
              onChange={e => set('supportFlowId', e.target.value || undefined)}
              className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all"
            >
              <option value="" className="bg-slate-900">Nenhum</option>
              {flows.map(f => <option key={f.id} value={f.id} className="bg-slate-900">{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Moeda padrão</label>
            <select value={globalConfig.defaultCurrency ?? 'BRL'} onChange={e => set('defaultCurrency', e.target.value)}
              className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all">
              <option value="BRL" className="bg-slate-900">BRL — Real</option>
              <option value="USD" className="bg-slate-900">USD — Dólar</option>
              <option value="EUR" className="bg-slate-900">EUR — Euro</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Expiração de pagamento (min)</label>
            <input type="number" min={5} max={1440}
              value={globalConfig.defaultPaymentExpirationMinutes ?? 60}
              onChange={e => set('defaultPaymentExpirationMinutes', Number(e.target.value))}
              className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all"
            />
          </div>
        </div>
      </ConfigSection>

      {/* Persona / Identidade */}
      <ConfigSection title="Persona & Identidade" subtitle="Como o bot se apresenta nas conversas">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Modo de identidade</label>
            <select value={globalConfig.assistantIdentityMode ?? 'brand_only'}
              onChange={e => set('assistantIdentityMode', e.target.value)}
              className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all">
              <option value="brand_only" className="bg-slate-900">Só marca (sem nome)</option>
              <option value="named" className="bg-slate-900">Com nome (ex: Bia)</option>
            </select>
          </div>
          <ConfigField label="Nome do assistente" value={globalConfig.assistantName ?? ''} onChange={v => set('assistantName', v)} placeholder="Bia" />
          <ConfigField label="Nome da empresa" value={globalConfig.companyName ?? ''} onChange={v => set('companyName', v)} placeholder="DramaHub" />
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Tom de voz</label>
            <select value={globalConfig.tone ?? 'acolhedor'} onChange={e => set('tone', e.target.value)}
              className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all">
              <option value="acolhedor" className="bg-slate-900">Acolhedor — emojis, diminutivos</option>
              <option value="casual" className="bg-slate-900">Casual — gírias leves, direto</option>
              <option value="profissional" className="bg-slate-900">Profissional — sem gírias</option>
              <option value="formal" className="bg-slate-900">Formal — sem emojis</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Idioma</label>
            <select value={globalConfig.locale ?? 'pt-BR'} onChange={e => set('locale', e.target.value)}
              className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all">
              <option value="pt-BR" className="bg-slate-900">Português (Brasil)</option>
              <option value="en-US" className="bg-slate-900">English (US)</option>
              <option value="es-ES" className="bg-slate-900">Español</option>
            </select>
          </div>
          <div className="flex items-center gap-3 pt-5">
            <button
              onClick={() => set('neverExposeAI', !globalConfig.neverExposeAI)}
              className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
                globalConfig.neverExposeAI === false ? 'bg-slate-700' : 'bg-brand-500'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                globalConfig.neverExposeAI === false ? '' : 'translate-x-5'
              }`} />
            </button>
            <div>
              <p className="text-xs font-medium text-slate-300">Nunca revelar que é IA</p>
              <p className="text-[10px] text-slate-600">
                {globalConfig.neverExposeAI === false ? 'Pode revelar se perguntado' : 'Sempre nega ser IA'}
              </p>
            </div>
          </div>
        </div>
      </ConfigSection>

      {/* Salvar */}
      <button disabled={configSaving} onClick={saveConfig}
        className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-all disabled:opacity-50">
        {configSaving ? <Loader2 size={14} className="animate-spin" /> : null}
        Salvar configurações
      </button>

      {/* Roteamento por Tag */}
      <ConfigSection title="Roteamento por Tag" subtitle="Lead com tag → redireciona para flow específico. Ordem importa.">
        <div className="space-y-2">
          {routingRules.length === 0 && (
            <p className="text-slate-500 text-xs py-4 text-center glass rounded-xl">Nenhuma regra. Sempre usa o flow ativo padrão.</p>
          )}
          {routingRules.map((rule, i) => (
            <div key={i} className="glass rounded-xl p-3 flex items-center gap-3">
              <span className="text-xs text-slate-500 w-4 text-center">{i + 1}</span>
              <span className="text-xs text-slate-400 shrink-0">Tag</span>
              <input
                value={rule.tag}
                onChange={e => setRoutingRules(r => r.map((x, j) => j === i ? { ...x, tag: e.target.value } : x))}
                placeholder="buyer"
                className="bg-slate-800/60 border border-slate-700/50 text-slate-200 text-xs rounded-lg px-2 py-1.5 outline-none w-28"
              />
              <ChevronRight size={12} className="text-slate-600 shrink-0" />
              <select
                value={rule.flowId}
                onChange={e => setRoutingRules(r => r.map((x, j) => j === i ? { ...x, flowId: e.target.value } : x))}
                className="bg-slate-800/60 border border-slate-700/50 text-slate-300 text-xs rounded-lg px-2 py-1.5 outline-none flex-1"
              >
                <option value="">Selecionar flow...</option>
                {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button onClick={() => setRoutingRules(r => r.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={() => setRoutingRules(r => [...r, { tag: '', flowId: '' }])}
            className="flex items-center gap-2 bg-glass-100 hover:bg-glass-200 border border-glass-border text-slate-300 text-xs font-medium px-3 py-2 rounded-xl transition-all">
            <Plus size={12} /> Adicionar regra
          </button>
          <button disabled={routingSaving} onClick={saveRouting}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium px-4 py-2 rounded-xl transition-all disabled:opacity-50">
            {routingSaving ? <Loader2 size={12} className="animate-spin" /> : null}
            Salvar regras
          </button>
        </div>
      </ConfigSection>

    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfigSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="glass p-5 rounded-2xl border border-glass-border">
        {children}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  )
}

function ConfigField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500/50 transition-all"
      />
    </div>
  )
}
