import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import gsap from 'gsap'
import {
  Plus, ExternalLink, QrCode, Power, PowerOff, Loader2, GitBranch,
  Trash2, Settings2, Package, ChevronRight, ArrowRight, Bot, Copy,
  Layers, Sparkles, BookOpen, CreditCard, LifeBuoy,
  RotateCcw, Search, Image as ImageIcon, Activity, Zap, X, Lightbulb,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, MkButton, MkField, MkTextarea, MkSwitch, Eyebrow, InfoTip } from '../components/mkhub'
import { ProposalsPanel } from '../components/builder/ProposalsPanel.tsx'
import { MetricsPanel } from '../components/builder/MetricsPanel.tsx'
import { api, type BotModule, type FlowSegment } from '../api/client.ts'
import { SegmentEditorModal } from '../components/flow/SegmentEditorModal.tsx'
import { useUIStore } from '../stores/uiStore.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutingRule { tag: string; flowId: string }

interface AgentTone {
  formality?: 'informal' | 'neutro' | 'formal'
  emoji?: 'nenhum' | 'raro' | 'moderado'
  length?: 'curtas' | 'medias'
  slang?: boolean
}

interface GlobalConfig {
  poolOptOut?: boolean
  defaultPixKey?: string
  defaultReceiverName?: string
  pixToleranceUnderCentavos?: number
  pixToleranceOverCentavos?: number
  ownerPhone?: string
  supportFlowId?: string
  defaultCurrency?: string
  defaultPaymentExpirationMinutes?: number
  assistantIdentityMode?: 'named' | 'brand_only'
  assistantName?: string
  companyName?: string
  agentKnowledge?: string
  agentInstructions?: string
  agentGreeting?: string
  agentIntroMessage?: string
  agentTestNumbers?: string[]
  agentTone?: AgentTone
  neverExposeAI?: boolean
  allowIdentityDisclosure?: boolean
  ownerTestMode?: boolean
  runtime?: 'flow' | 'agent'
  tone?: 'acolhedor' | 'profissional' | 'casual' | 'formal'
  locale?: 'pt-BR' | 'en-US' | 'es-ES'
  modules?: Record<string, { enabled: boolean; config?: Record<string, unknown> }>
  aiGapFill?: { enabled?: boolean; onUnhandled?: 'reask' | 'handoff'; maxConsecutive?: number }
}

interface PersonaPreview {
  identityLine: string
  greetingExample: string
  paymentExample: string
  handoffExample: string
  toneExample: string
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

interface FlowData { id: string; name: string; nodes: unknown[]; edges: unknown[] }

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'config',       label: 'Config',       icon: Settings2 },
  { id: 'automacao',    label: 'Flows',        icon: GitBranch, mode: 'flow' },   // só Fluxo
  { id: 'modulos',      label: 'Módulos',      icon: Layers },
  { id: 'skills',       label: 'Segmentos',    icon: Sparkles, mode: 'flow' },
  { id: 'propostas',    label: 'Propostas',    icon: Lightbulb, mode: 'flow' },
  { id: 'painel',       label: 'Painel',       icon: Activity },
  { id: 'cerebro',      label: 'Cérebro',      icon: BookOpen },
] as const

type TabId = typeof TABS[number]['id']

// Presentation map: icon + kind label per module id (backend owns the truth; this is just chrome).
const MODULE_ICON: Record<string, LucideIcon> = {
  payment_pix: CreditCard, human_handoff: LifeBuoy, catalog: Search,
  delivery: Package, recover: RotateCcw, media: ImageIcon,
}
const KIND_LABEL: Record<BotModule['type'], string> = {
  routable: 'roteável', tool: 'ferramenta', effect: 'efeito',
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BotConfig() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { setCurrentBot } = useUIStore()

  const rawTab: TabId = (searchParams.get('tab') as TabId) ?? 'config'

  const [bot, setBot] = useState<BotData | null>(null)
  const [flows, setFlows] = useState<FlowData[]>([])
  const [modules, setModules] = useState<BotModule[]>([])
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [showQR, setShowQR] = useState(false)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')
  const [waState, setWaState] = useState<'open' | 'connecting' | 'close' | null>(null)
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([])
  const [routingSaving, setRoutingSaving] = useState(false)
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>({})
  const [preview, setPreview] = useState<PersonaPreview | null>(null)
  const [savingTab, setSavingTab] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!botId) return
    Promise.all([
      api.bots.get(botId),
      api.flows.list(botId),
      api.bots.connectionStatus(botId),
      api.bots.modules(botId),
    ]).then(([b, f, s, m]) => {
      const botData = b as BotData
      setBot(botData)
      setCurrentBot({ id: botData.id, name: botData.name })
      setRoutingRules(botData.routingRules ?? [])
      setGlobalConfig(botData.globalConfig ?? {})
      setFlows(f as FlowData[])
      setWaState((s as { state: 'open' | 'connecting' | 'close' }).state)
      setModules((m as { modules: BotModule[] }).modules)
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

  // Save a slice of globalConfig via the validated endpoint (persona preview + cache invalidation).
  const saveGlobal = async (patch: Partial<GlobalConfig>, tabKey: string) => {
    if (!botId) return
    setSavingTab(tabKey)
    try {
      const res = await api.bots.updateGlobalConfig(botId, patch as Record<string, unknown>)
      setGlobalConfig(c => ({ ...c, ...patch }))
      if (res?.preview) setPreview(res.preview as PersonaPreview)
    } finally { setSavingTab(null) }
  }

  const setRuntime = (runtime: 'flow' | 'agent') => {
    setGlobalConfig(c => ({ ...c, runtime }))
    void saveGlobal({ runtime }, 'runtime')
  }

  const createFlow = async () => {
    if (!botId) return
    const name = prompt('Nome do fluxo:')
    if (!name) return
    const flow = await api.flows.create(botId, { name, nodes: [], edges: [] }) as FlowData
    setFlows(f => [...f, flow])
  }

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

  const saveRouting = async () => {
    if (!botId) return
    setRoutingSaving(true)
    try { await api.bots.updateRoutingRules(botId, routingRules) }
    finally { setRoutingSaving(false) }
  }

  if (!bot) return null

  // Em modo Agente, as opções SÓ-do-Fluxo somem (grafo, escape hatch, roteamento por tag, capabilities, habilidades do fluxo).
  const isAgent = (globalConfig.runtime ?? 'flow') === 'agent'
  const visibleTabs = TABS.filter(t => !(((t as { mode?: string }).mode === 'flow') && isAgent))
  const activeTab: TabId = visibleTabs.some(t => t.id === rawTab) ? rawTab : 'config'

  return (
    <MkLayout>
      <div className="max-w-4xl mx-auto">

        {/* Status bar */}
        <div className="flex items-center gap-3 mb-7">
          <div style={{ width: 40, height: 40, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bot size={18} strokeWidth={1.6} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 ref={headingRef} className="mk-display" style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{bot.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1.5" style={{ fontSize: '.76rem', color: 'var(--muted)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: waState === 'open' ? '#22a06b' : waState === 'connecting' ? '#d9a300' : '#bcbcb8' }} className={waState === 'connecting' ? 'animate-pulse' : ''} />
                {waState === 'open' ? 'Conectado' : waState === 'connecting' ? 'Conectando…' : waState === 'close' ? 'Desconectado' : '—'}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: '.76rem' }}>·</span>
              <span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{bot.productInfo.name}</span>
            </div>
          </div>
          <InfoTip width={300} text={<><strong>Quem é o cérebro do bot.</strong><br />• <strong>Fluxo</strong>: o grafo de nós (que você edita) decide tudo, passo a passo — previsível.<br />• <strong>Agente</strong>: a IA decide na hora usando os módulos ligados.<br />Trocar aqui muda o que responde os clientes na próxima mensagem.</>} />
          <RuntimeSwitch value={globalConfig.runtime ?? 'flow'} onChange={setRuntime} saving={savingTab === 'runtime'} />
          <span className="text-xs font-semibold" style={bot.isActive
            ? { background: 'var(--ink)', color: 'var(--paper)', padding: '5px 14px', borderRadius: 999 }
            : { border: '1px solid var(--line)', color: 'var(--muted)', padding: '4px 13px', borderRadius: 999 }}>
            {bot.isActive ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex gap-7 mb-8 overflow-x-auto" style={{ borderBottom: '1px solid var(--line)' }}>
          {visibleTabs.map(tab => {
            const active = activeTab === tab.id
            return (
              <button key={tab.id} onClick={() => setTab(tab.id)}
                className="flex items-center gap-2 pb-3 text-sm transition-colors whitespace-nowrap"
                style={{ color: active ? 'var(--ink)' : 'var(--muted)', fontWeight: active ? 600 : 500, borderBottom: active ? '2px solid var(--ink)' : '2px solid transparent', marginBottom: -1 }}>
                <tab.icon size={14} strokeWidth={1.8} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {activeTab === 'config' && (
          <ConfigTab
            bot={bot} flows={flows} botId={botId!} navigate={navigate} isAgent={isAgent}
            globalConfig={globalConfig} setGlobalConfig={setGlobalConfig}
            saveGlobal={saveGlobal} savingTab={savingTab}
            routingRules={routingRules} setRoutingRules={setRoutingRules} routingSaving={routingSaving} saveRouting={saveRouting}
            waState={waState} qrLoading={qrLoading} qrError={qrError} showQR={showQR} qrCode={qrCode} loadQR={loadQR}
          />
        )}

        {activeTab === 'automacao' && (
          <AutomacaoTab bot={bot} flows={flows} botId={botId!} navigate={navigate} createFlow={createFlow} cloneFlow={cloneFlow} toggleActive={toggleActive} />
        )}

        {activeTab === 'modulos' && (
          <ModulosTab modules={modules} setModules={setModules} globalConfig={globalConfig} setGlobalConfig={setGlobalConfig} saveGlobal={saveGlobal} savingTab={savingTab} />
        )}

        {activeTab === 'skills' && (
          <SkillsTab flows={flows} activeFlowId={bot.activeFlowId} />
        )}

        {activeTab === 'propostas' && (
          <ProposalsPanel botId={bot.id} activeFlowId={bot.activeFlowId} />
        )}
        {activeTab === 'painel' && (
          <MetricsPanel
            botId={bot.id}
            optedOut={!!globalConfig.poolOptOut}
            onToggleOptOut={(v) => saveGlobal({ poolOptOut: v }, 'pool')}
            savingOptOut={savingTab === 'pool'}
          />
        )}

        {activeTab === 'cerebro' && (
          <CerebroTab globalConfig={globalConfig} setGlobalConfig={setGlobalConfig} saveGlobal={saveGlobal} savingTab={savingTab} preview={preview} />
        )}

      </div>
    </MkLayout>
  )
}

// ─── Tab: Config ──────────────────────────────────────────────────────────────

function ConfigTab({
  bot, flows, botId, navigate, isAgent, globalConfig, setGlobalConfig, saveGlobal, savingTab,
  routingRules, setRoutingRules, routingSaving, saveRouting,
  waState, qrLoading, qrError, showQR, qrCode, loadQR,
}: {
  bot: BotData; flows: FlowData[]; botId: string; navigate: (p: string) => void; isAgent: boolean
  globalConfig: GlobalConfig; setGlobalConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>
  saveGlobal: (patch: Partial<GlobalConfig>, tabKey: string) => void; savingTab: string | null
  routingRules: RoutingRule[]; setRoutingRules: React.Dispatch<React.SetStateAction<RoutingRule[]>>
  routingSaving: boolean; saveRouting: () => void
  waState: string | null; qrLoading: boolean; qrError: string; showQR: boolean; qrCode: string | null; loadQR: () => void
}) {
  const set = (k: keyof GlobalConfig, v: unknown) => setGlobalConfig(c => ({ ...c, [k]: v }))
  const saveBasics = () => saveGlobal({
    supportFlowId: globalConfig.supportFlowId, defaultCurrency: globalConfig.defaultCurrency,
    ownerTestMode: globalConfig.ownerTestMode,
    agentTestNumbers: globalConfig.agentTestNumbers,
  }, 'config')

  const [showHatchHelp, setShowHatchHelp] = useState(false)
  // Fluxo ativo já tem IA própria? (aí o escape hatch é redundante — o modal recomenda)
  const activeFlow = flows.find(f => f.id === bot.activeFlowId)
  const flowHasAI = ((activeFlow?.nodes ?? []) as { type?: string; data?: { aiAgent?: { enabled?: boolean } } }[])
    .some(n => n.type === 'ai_router' || n.type === 'ai_response' || (n.type === 'classify_intent' && !!n.data?.aiAgent?.enabled))

  return (
    <div className="space-y-9">
      {/* Connection */}
      <ConfigSection title="Conexão WhatsApp" subtitle="Estado da instância e leitura do QR"
        info={<>Liga o bot a um número de WhatsApp. <strong>Verde</strong> = conectado e respondendo. Se cair, clique em <strong>Mostrar QR Code</strong> e escaneie pelo WhatsApp do número (Aparelhos conectados).</>}>
        <div className="flex items-center gap-2 mb-4">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: waState === 'open' ? '#22a06b' : waState === 'connecting' ? '#d9a300' : '#bcbcb8' }} className={waState === 'connecting' ? 'animate-pulse' : ''} />
          <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            {waState === 'open' ? 'Conectado' : waState === 'connecting' ? 'Conectando...' : waState === 'close' ? 'Desconectado' : '—'}
          </span>
          <span className="text-xs ml-auto font-mono" style={{ color: 'var(--muted)' }}>{bot.evolutionConfig.instanceName}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {waState !== 'open' && (
            <button onClick={loadQR} disabled={qrLoading}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl"
              style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--paper-2)' }}>
              {qrLoading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />} Mostrar QR Code
            </button>
          )}
          <a href="https://evolution.whatsbot.mfslabs.com.br/manager" target="_blank" rel="noreferrer"
            className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl"
            style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>
            <ExternalLink size={14} /> Evolution Manager
          </a>
        </div>
        {qrError && <p className="mt-3 text-xs rounded-lg px-3 py-2.5" style={{ background: 'rgba(217,163,0,0.08)', border: '1px solid rgba(217,163,0,0.2)', color: '#9a7400' }}>{qrError}</p>}
        {showQR && qrCode && waState !== 'open' && (
          <div className="mt-4 p-3 bg-white rounded-xl inline-block" style={{ border: '1px solid var(--line)' }}>
            <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-40 h-40" />
          </div>
        )}
      </ConfigSection>

      {/* Runtime + teste */}
      <ConfigSection title="Runtime & Teste" subtitle="Fluxo = o grafo é o cérebro · Agente = a IA orquestra (tool-calling). Números de teste usam o agente mesmo em Fluxo."
        info={<><strong>Números de teste:</strong> esses telefones falam com a <strong>IA (Agente)</strong> mesmo que o bot esteja em <strong>Fluxo</strong>. Serve pra você testar o agente sem afetar clientes reais (eles seguem no fluxo). <br /><br /><strong>Modo teste (dono):</strong> por padrão o bot ignora mensagens do próprio dono; ligue pra conseguir testar com seu número.</>}>
        <div className="grid grid-cols-2 gap-5">
          <MkSelect label="Moeda padrão" value={globalConfig.defaultCurrency ?? 'BRL'} onChange={v => set('defaultCurrency', v)}>
            <option value="BRL">BRL — Real</option>
            <option value="USD">USD — Dólar</option>
            <option value="EUR">EUR — Euro</option>
          </MkSelect>
          <MkSelect label="Fluxo de suporte pós-compra" value={globalConfig.supportFlowId ?? ''} onChange={v => set('supportFlowId', v || undefined)}>
            <option value="">Nenhum</option>
            {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </MkSelect>
          <div className="col-span-2">
            <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Números de teste do agente (um por linha)</label>
            <textarea
              value={(globalConfig.agentTestNumbers ?? []).join('\n')}
              onChange={e => set('agentTestNumbers', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
              rows={3} placeholder={'5511999999999\n5592888888888'}
              className="mk-input w-full px-3 py-2.5 text-sm font-mono" style={{ resize: 'vertical' }} />
          </div>
          <ToggleRow on={!!globalConfig.ownerTestMode} onChange={() => set('ownerTestMode', !globalConfig.ownerTestMode)}
            title="Modo teste (dono)" desc={globalConfig.ownerTestMode ? 'Dono pode testar o fluxo' : 'Mensagens do dono ignoradas'} />
        </div>
        <div className="mt-5">
          <MkButton onClick={saveBasics} disabled={savingTab === 'config'}>
            {savingTab === 'config' ? <Loader2 size={14} className="animate-spin" /> : null} Salvar
          </MkButton>
        </div>
      </ConfigSection>

      {/* Inteligência — escape hatch (só Fluxo) */}
      {!isAgent && <ConfigSection title="Inteligência do bot" badge="cobre Fluxo"
        subtitle="Quando o cliente sai do roteiro, a IA responde e devolve o controle pro fluxo. Você descreve as partes; a IA cobre as lacunas."
        info={<><strong>IA cobre lacunas (escape hatch)</strong>: camada que entra quando a mensagem <strong>não encaixa</strong> no passo atual — responde dúvida/objeção (do Conhecimento) e devolve o controle, ou roteia. Custa 1 chamada barata só quando sai do roteiro. <strong>Default desligado</strong>. <br/><br/>⚠️ <strong>Importante:</strong> controla SÓ esta camada. Se o seu fluxo tiver <strong>nós de IA próprios</strong> (ex.: AI Router, Responder Dúvida), eles respondem independente deste toggle. A unificação (toggle único pra toda IA off-script) é a Fase 2 do plano.</>}>
        <div className="space-y-5">
          <ToggleRow on={!!globalConfig.aiGapFill?.enabled}
            onChange={() => set('aiGapFill', { ...globalConfig.aiGapFill, enabled: !globalConfig.aiGapFill?.enabled })}
            title="IA cobre lacunas (escape hatch)" desc={globalConfig.aiGapFill?.enabled ? 'IA entra quando o cliente sai do roteiro' : 'Desligado — esta camada não entra. (Atenção: se o seu fluxo tiver nós de IA próprios, ex. AI Router, eles seguem ativos — este toggle não os controla.)'} />
          {globalConfig.aiGapFill?.enabled && (
            <MkSelect label="Quando a IA não souber" value={globalConfig.aiGapFill?.onUnhandled ?? 'reask'}
              onChange={v => set('aiGapFill', { ...globalConfig.aiGapFill, onUnhandled: v as 'reask' | 'handoff' })}>
              <option value="reask">Re-perguntar (continua a conversa)</option>
              <option value="handoff">Chamar humano (escala)</option>
            </MkSelect>
          )}
          <div className="flex items-center gap-3">
            <MkButton onClick={() => saveGlobal({ aiGapFill: globalConfig.aiGapFill }, 'gapfill')} disabled={savingTab === 'gapfill'}>
              {savingTab === 'gapfill' ? <Loader2 size={14} className="animate-spin" /> : null} Salvar
            </MkButton>
            <MkButton variant="ghost" onClick={() => setShowHatchHelp(true)}>Vale a pena pro meu bot?</MkButton>
          </div>
        </div>
      </ConfigSection>}

      {showHatchHelp && <EscapeHatchHelp flowHasAI={flowHasAI} onClose={() => setShowHatchHelp(false)} />}

      {/* Roteamento (só Fluxo) */}
      {!isAgent && <ConfigSection title="Roteamento por Tag" subtitle="Lead com tag → redireciona para flow específico. Ordem importa."
        info={<>Decide <strong>qual fluxo</strong> roda pra cada pessoa. As regras são lidas <strong>de cima pra baixo</strong>: o 1º cuja tag o lead tem vence. Se nenhuma casar, usa o <strong>fluxo ativo padrão</strong>. (Só vale no modo Fluxo.)</>}>
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
      </ConfigSection>}

      {/* Diagnóstico (ops) — gaveta colapsada, FORA do caminho do lojista. Inspecionar, não configurar.
          Capabilities removido da UI (passo 6); CapabilityRouter no backend permanece p/ bots-flow. */}
      <details className="mt-2">
        <summary className="flex items-center gap-2 cursor-pointer select-none">
          <Eyebrow>Diagnóstico</Eyebrow>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>ferramentas de ops — inspecionar, não configurar</span>
        </summary>
        <div className="grid grid-cols-1 gap-2 mt-3">
          {[
            { label: 'Trilha do Agente', desc: 'ferramentas/argumentos/resultados que a IA chamou', icon: Bot, path: 'agent-trace' },
            { label: 'AI Patterns', desc: 'decisões do roteador de IA e taxa de fallback', icon: Activity, path: 'patterns' },
            { label: 'Eventos', desc: 'log de eventos da conversa em tempo real', icon: Zap, path: 'events' },
          ].map(card => (
            <button key={card.path} onClick={() => navigate(`/bots/${botId}/${card.path}`)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:opacity-70"
              style={{ border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
              <card.icon size={14} strokeWidth={1.6} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <span className="text-sm" style={{ color: 'var(--ink)' }}>{card.label}</span>
              <span className="text-xs flex-1" style={{ color: 'var(--muted)' }}>{card.desc}</span>
              <ArrowRight size={13} strokeWidth={1.6} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}

// ─── Tab: Módulos ─────────────────────────────────────────────────────────────

function ModulosTab({
  modules, setModules, globalConfig, setGlobalConfig, saveGlobal, savingTab,
}: {
  modules: BotModule[]; setModules: React.Dispatch<React.SetStateAction<BotModule[]>>
  globalConfig: GlobalConfig; setGlobalConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>
  saveGlobal: (patch: Partial<GlobalConfig>, tabKey: string) => void; savingTab: string | null
}) {
  const set = (k: keyof GlobalConfig, v: unknown) => setGlobalConfig(c => ({ ...c, [k]: v }))
  const recoverCfg = (modules.find(m => m.id === 'recover')?.config ?? {}) as {
    idleMinutes?: number; maxAttempts?: number; messages?: string[]
  }
  const setRecover = (patch: Partial<typeof recoverCfg>) =>
    setModules(ms => ms.map(m => m.id === 'recover' ? { ...m, config: { ...m.config, ...patch } } : m))

  const toggle = (id: string) =>
    setModules(ms => ms.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m))

  const save = () => {
    const modulesPatch: GlobalConfig['modules'] = {}
    for (const m of modules) {
      modulesPatch[m.id] = { enabled: m.enabled }
    }
    // recover é o único com config canônica (modules.recover.config) — TimeoutService lê daqui.
    const rc = modules.find(m => m.id === 'recover')
    if (rc) modulesPatch['recover'] = { enabled: rc.enabled, config: rc.config }
    saveGlobal({
      modules: modulesPatch,
      // payment_pix / human_handoff = blobs (o registry lê via legacyConfig — sem refactor de leitor)
      defaultPixKey: globalConfig.defaultPixKey,
      defaultReceiverName: globalConfig.defaultReceiverName,
      defaultPaymentExpirationMinutes: globalConfig.defaultPaymentExpirationMinutes,
      ownerPhone: globalConfig.ownerPhone,
    }, 'modulos')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="mk-display" style={{ fontSize: '1.15rem', fontWeight: 600 }}>Módulos</h2>
            <InfoTip width={300} text={<>Máquinas prontas da plataforma — você liga/desliga e configura, sem montar nó a nó. Os 3 tipos: <strong>roteável</strong> (a IA aciona por mensagem, ex: pagar), <strong>ferramenta</strong> (a IA usa quando precisa, ex: buscar no catálogo), <strong>efeito</strong> (dispara sozinho por evento, ex: entregar após o pagamento). Desligar tira essa capacidade do bot.</>} />
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '.8rem', marginTop: 2 }}>Ligue, desligue e configure as máquinas prontas da plataforma. Desligar remove a capacidade do agente.</p>
        </div>
        <MkButton onClick={save} disabled={savingTab === 'modulos'}>
          {savingTab === 'modulos' ? <Loader2 size={14} className="animate-spin" /> : null} Salvar módulos
        </MkButton>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' }}>
        {modules.map(m => {
          const Icon = MODULE_ICON[m.id] ?? Layers
          return (
            <div key={m.id} className="mk-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12, opacity: m.enabled ? 1 : 0.5 }}>
              <div className="flex items-start justify-between">
                <div style={{ width: 42, height: 42, borderRadius: 13, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-2)' }}>
                  <Icon size={18} strokeWidth={1.6} />
                </div>
                <MkSwitch on={m.enabled} onChange={() => toggle(m.id)} label={m.name} />
              </div>
              <div>
                <h3 className="mk-display" style={{ fontSize: '1.02rem', fontWeight: 600 }}>{m.name}</h3>
                <span className="mk-eyebrow" style={{ fontSize: '.58rem' }}>{KIND_LABEL[m.type]}</span>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '.85rem', lineHeight: 1.5, flex: 1 }}>{m.description}</p>

              {/* Config panel — só onde há leitor real */}
              {m.id === 'payment_pix' && m.enabled && (
                <div className="space-y-3 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                  <MkField label="Chave PIX" value={globalConfig.defaultPixKey ?? ''} onChange={v => set('defaultPixKey', v)} placeholder="email@exemplo.com" />
                  <MkField label="Favorecido" value={globalConfig.defaultReceiverName ?? ''} onChange={v => set('defaultReceiverName', v)} placeholder="João Silva" />
                  <div>
                    <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Expiração (min)</label>
                    <input type="number" min={5} max={1440} value={globalConfig.defaultPaymentExpirationMinutes ?? 60}
                      onChange={e => set('defaultPaymentExpirationMinutes', Number(e.target.value))}
                      className="mk-input w-full px-3 py-2.5 text-sm" />
                  </div>
                  {/* Tolerância do validador de comprovante — valores em R$, salvos em centavos */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Aceitar até (R$) a menos</label>
                      <input type="number" min={0} step={0.5}
                        value={((globalConfig.pixToleranceUnderCentavos as number | undefined) ?? 0) / 100}
                        onChange={e => set('pixToleranceUnderCentavos', Math.round(Number(e.target.value || 0) * 100))}
                        className="mk-input w-full px-3 py-2.5 text-sm" />
                    </div>
                    <div>
                      <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Teto do a mais (R$)</label>
                      <input type="number" min={0} step={0.5} placeholder="sem limite"
                        value={(globalConfig.pixToleranceOverCentavos as number | undefined) != null ? (globalConfig.pixToleranceOverCentavos as number) / 100 : ''}
                        onChange={e => set('pixToleranceOverCentavos', e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100))}
                        className="mk-input w-full px-3 py-2.5 text-sm" />
                    </div>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Comprovante com valor dentro dessas margens aprova sozinho. Acima do teto (ou abaixo do "a menos") cai pra confirmação humana.
                  </p>
                </div>
              )}
              {m.id === 'human_handoff' && m.enabled && (
                <div className="pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                  <MkField label="Telefone do dono" value={globalConfig.ownerPhone ?? ''} onChange={v => set('ownerPhone', v)} placeholder="5511999999999" />
                </div>
              )}
              {m.id === 'recover' && m.enabled && (
                <div className="space-y-3 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Ocioso (min)</label>
                      <input type="number" min={1} max={1440} value={recoverCfg.idleMinutes ?? 30}
                        onChange={e => setRecover({ idleMinutes: Number(e.target.value) })}
                        className="mk-input w-full px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Tentativas</label>
                      <input type="number" min={1} max={5} value={recoverCfg.maxAttempts ?? 2}
                        onChange={e => setRecover({ maxAttempts: Number(e.target.value) })}
                        className="mk-input w-full px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>Mensagens (uma por tentativa)</label>
                    <textarea value={(recoverCfg.messages ?? []).join('\n')}
                      onChange={e => setRecover({ messages: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                      rows={2} placeholder={'Oi {nome}, ainda quer fechar?\nÚltima chamada do {item} 👀'}
                      className="mk-input w-full px-3 py-2 text-sm" style={{ resize: 'vertical' }} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tab: Skills ──────────────────────────────────────────────────────────────

function SkillsTab({ flows, activeFlowId }: { flows: FlowData[]; activeFlowId: string | null }) {
  return (
    <div className="space-y-9">
      <FlowSegments flows={flows} activeFlowId={activeFlowId} />
    </div>
  )
}

// ─── Habilidades do fluxo (segmentos descritos) ──────────────────────────────
// Transforma o flow (nós anônimos) em capacidades nomeadas + descrição que a IA lê.
// IA gera (C), humano revisa e salva. Ver Brain/spec_skills_segmentos.md.

function FlowSegments({ flows, activeFlowId }: { flows: FlowData[]; activeFlowId: string | null }) {
  const [flowId, setFlowId] = useState<string>(activeFlowId ?? flows[0]?.id ?? '')
  const [segments, setSegments] = useState<FlowSegment[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<FlowSegment | null>(null)
  // Cópia local do grafo do fluxo (nós/edges), atualizada quando o modal salva uma parte — evita refetch.
  const [override, setOverride] = useState<{ id: string; nodes: unknown[]; edges: unknown[] } | null>(null)

  const selectedFlow = flows.find(f => f.id === flowId)
  const flowNodes = (override?.id === flowId ? override.nodes : selectedFlow?.nodes) ?? []
  const flowEdges = (override?.id === flowId ? override.edges : selectedFlow?.edges) ?? []
  const nodeLabels = new Map<string, string>(
    (flowNodes as { id: string; data?: { label?: string } }[]).map(n => [n.id, n.data?.label ?? n.id])
  )

  useEffect(() => {
    if (!flowId) return
    setLoading(true); setErr(''); setDirty(false); setOverride(null)
    api.flows.segments(flowId)
      .then(r => setSegments(r.segments))
      .catch(e => setErr(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => setLoading(false))
  }, [flowId])

  const generate = async () => {
    if (!flowId) return
    setGenerating(true); setErr('')
    try {
      const r = await api.flows.generateSegments(flowId)
      setSegments(r.segments)
      setDirty(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao gerar com IA')
    } finally { setGenerating(false) }
  }

  const saveSegs = async () => {
    if (!flowId) return
    setSaving(true); setErr('')
    try {
      const r = await api.flows.saveSegments(flowId, segments)
      setSegments(r.segments); setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally { setSaving(false) }
  }

  const update = (i: number, patch: Partial<FlowSegment>) => {
    setSegments(s => s.map((seg, j) => j === i ? { ...seg, ...patch } : seg)); setDirty(true)
  }
  const remove = (i: number) => { setSegments(s => s.filter((_, j) => j !== i)); setDirty(true) }
  const add = () => {
    setSegments(s => [...s, { id: crypto.randomUUID(), name: '', description: '', whenToUse: '', nodeIds: [] }]); setDirty(true)
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Eyebrow>Habilidades do fluxo</Eyebrow>
            <InfoTip width={300} text={<>As partes do seu fluxo, nomeadas e descritas. Cada habilidade agrupa nós (ex: "Boas-vindas", "Pagamento PIX"). <strong>"Editar parte"</strong> abre só os nós daquela parte pra editar isolado. <strong>"Gerar com IA"</strong> mapeia tudo automaticamente — depois você revisa. É a abertura/comportamento real no modo <strong>Fluxo</strong>.</>} />
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '.78rem', maxWidth: 460 }}>
            O que está mapeado dentro do fluxo, em partes nomeadas + descrição. É o que a IA lê pra entender e usar cada parte. Gere com IA e revise.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {flows.length > 1 && (
            <select value={flowId} onChange={e => setFlowId(e.target.value)} className="mk-input text-xs px-2 py-2">
              {flows.map(f => <option key={f.id} value={f.id}>{f.name}{f.id === activeFlowId ? ' (ativo)' : ''}</option>)}
            </select>
          )}
          <MkButton variant="ghost" onClick={generate} disabled={generating || !flowId}>
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Gerar com IA
          </MkButton>
          {dirty && (
            <MkButton onClick={saveSegs} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Salvar
            </MkButton>
          )}
        </div>
      </div>

      {err && <p className="text-xs rounded-lg px-3 py-2.5 mb-3" style={{ background: 'rgba(217,163,0,0.08)', border: '1px solid rgba(217,163,0,0.2)', color: '#9a7400' }}>{err}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center" style={{ color: 'var(--muted)' }}>
          <Loader2 size={15} className="animate-spin" /> <span className="text-sm">Carregando…</span>
        </div>
      ) : segments.length === 0 ? (
        <MkCard style={{ padding: '40px 28px', textAlign: 'center' }}>
          <Sparkles size={24} strokeWidth={1.4} style={{ margin: '0 auto 12px', color: 'var(--muted)' }} />
          <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem' }}>Nenhuma habilidade descrita ainda.</p>
          <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: 4, marginBottom: 18 }}>
            Clique em <strong>Gerar com IA</strong> pra mapear as partes do fluxo automaticamente — depois revise.
          </p>
        </MkCard>
      ) : (
        <div className="space-y-3">
          {segments.map((seg, i) => (
            <MkCard key={seg.id} style={{ padding: 18 }}>
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <input value={seg.name} onChange={e => update(i, { name: e.target.value })}
                      placeholder="Nome da habilidade (ex: Pagamento PIX)"
                      className="mk-input text-sm font-semibold px-3 py-2 flex-1" />
                    {seg.generated && (
                      <span className="mk-eyebrow" style={{ fontSize: '.54rem', color: '#9a7400', background: 'rgba(217,163,0,0.1)', padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>IA · revise</span>
                    )}
                  </div>
                  <textarea value={seg.description} onChange={e => update(i, { description: e.target.value })}
                    rows={2} placeholder="O que faz (a IA lê isso pra decidir usar)"
                    className="mk-input w-full text-sm px-3 py-2" style={{ resize: 'vertical' }} />
                  <input value={seg.whenToUse ?? ''} onChange={e => update(i, { whenToUse: e.target.value })}
                    placeholder="Quando usar (gatilho)"
                    className="mk-input w-full text-xs px-3 py-2" />
                  {seg.nodeIds.length > 0 && (
                    <div className="pt-1">
                      <span className="mk-eyebrow block mb-1.5" style={{ fontSize: '.56rem' }}>
                        {seg.nodeIds.length} {seg.nodeIds.length === 1 ? 'nó' : 'nós'}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {seg.nodeIds.map(id => {
                          const known = nodeLabels.has(id)
                          return (
                            <span key={id} title={known ? id : 'nó não encontrado no fluxo atual'}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md"
                              style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', color: known ? 'var(--ink-soft)' : 'var(--muted)', textDecoration: known ? 'none' : 'line-through' }}>
                              <GitBranch size={10} strokeWidth={1.8} style={{ opacity: 0.5, flexShrink: 0 }} />
                              {nodeLabels.get(id) ?? id}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="pt-1 flex flex-wrap items-center gap-3">
                    <button onClick={() => setEditing(seg)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all"
                      style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--paper-2)' }}>
                      <GitBranch size={13} strokeWidth={1.9} /> Editar parte
                    </button>
                    <span className="flex items-center gap-1.5">
                      <label className="mk-eyebrow" style={{ fontSize: '.56rem' }}>IA nas lacunas</label>
                      <InfoTip text={<>O que a IA faz se o cliente sair do roteiro <strong>nesta parte</strong>. <strong>Herdar</strong> = usa o padrão do bot. <strong>Desligado</strong> = parte sagrada, IA não entra. <strong>Cobre</strong> = IA responde e devolve. <strong>Só humano</strong> = qualquer desvio escala.</>} />
                      <select value={seg.escapeMode ?? 'inherit'} onChange={e => update(i, { escapeMode: e.target.value as FlowSegment['escapeMode'] })}
                        className="mk-input text-xs px-2 py-1.5">
                        <option value="inherit">Herdar do bot</option>
                        <option value="off">Desligado</option>
                        <option value="cover">Cobre</option>
                        <option value="handoff">Só humano</option>
                      </select>
                    </span>
                  </div>
                  {seg.escapeMode && seg.escapeMode !== 'off' && seg.escapeMode !== 'inherit' && (
                    <input value={seg.escapeHint ?? ''} onChange={e => update(i, { escapeHint: e.target.value })}
                      placeholder="Dica: quando sair do roteiro aqui… (ex: se perguntarem de reembolso, explique a política)"
                      className="mk-input w-full text-xs px-3 py-2" />
                  )}
                </div>
                <button onClick={() => remove(i)} style={{ color: 'var(--muted)' }} className="hover:opacity-60 mt-1"><Trash2 size={14} /></button>
              </div>
            </MkCard>
          ))}
          <MkButton variant="ghost" onClick={add}><Plus size={12} /> Adicionar habilidade</MkButton>
        </div>
      )}

      {editing && flowId && (
        <SegmentEditorModal
          flowId={flowId}
          flowName={selectedFlow?.name ?? 'Flow'}
          fullNodes={flowNodes as never}
          fullEdges={flowEdges as never}
          segment={segments.find(s => s.id === editing.id) ?? editing}
          allSegments={segments}
          onClose={() => setEditing(null)}
          onSaved={({ segments: segs, nodes, edges }) => { setSegments(segs); setOverride({ id: flowId, nodes, edges }) }}
        />
      )}
    </div>
  )
}

// ─── Tab: Conhecimento ────────────────────────────────────────────────────────

// ─── Tab: Cérebro (poda passo 4) — "descrever o negócio" num lugar só: Instruções + Conhecimento + Tom.
// Reusa ConhecimentoTab + TomTab; mantém as MESMAS chaves de globalConfig (sem renomear estado). ──────
function CerebroTab({
  globalConfig, setGlobalConfig, saveGlobal, savingTab, preview,
}: {
  globalConfig: GlobalConfig; setGlobalConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>
  saveGlobal: (patch: Partial<GlobalConfig>, tabKey: string) => void; savingTab: string | null
  preview: PersonaPreview | null
}) {
  const set = (k: keyof GlobalConfig, v: unknown) => setGlobalConfig(c => ({ ...c, [k]: v }))
  const saveAgent = () => saveGlobal({
    agentInstructions: globalConfig.agentInstructions,
    agentIntroMessage: globalConfig.agentIntroMessage,
    agentGreeting: globalConfig.agentGreeting,
  }, 'cerebro')

  return (
    <div className="space-y-9">
      <ConfigSection title="Como o agente age" subtitle="Regras e jeito de vender — vira o system prompt do agente. A IA propõe, o código dispõe." badge="modo Agente"
        info={<>Vale só quando o runtime está em <strong>Agente</strong>. São as regras de conduta da IA (como vender, o que nunca prometer). No modo <strong>Fluxo</strong>, quem manda são os nós, não isto.</>}>
        <MkTextarea label="Instruções do agente" value={globalConfig.agentInstructions ?? ''}
          onChange={v => set('agentInstructions', v)} rows={7}
          placeholder={'Ex:\n- Sempre confirme o título antes de gerar o PIX\n- Se a pessoa hesitar, ofereça o pacote\n- Nunca prometa o que o módulo não faz'} />
      </ConfigSection>

      <ConfigSection title="Abertura" subtitle="Como o bot inicia a 1ª conversa. Mensagem exata tem prioridade; a orientação deixa a IA abrir com as palavras dela." badge="modo Agente"
        info={<>Esta abertura só é usada no modo <strong>Agente</strong>. No modo <strong>Fluxo</strong>, quem dá as boas-vindas são os nós da habilidade "Boas-vindas".</>}>
        <div className="space-y-5">
          <MkTextarea label="Mensagem de abertura (exata, verbatim)" value={globalConfig.agentIntroMessage ?? ''}
            onChange={v => set('agentIntroMessage', v)} rows={3}
            placeholder="Oi! Bem-vindo à DramaHub 🎬 Qual série você procura?"
            hint="Enviada literal no 1º contato. Use quando copy/preços precisam ser exatos (não passa pela IA)." />
          <MkTextarea label="Orientação de abertura (IA)" value={globalConfig.agentGreeting ?? ''}
            onChange={v => set('agentGreeting', v)} rows={2}
            placeholder="Apresente-se de forma calorosa e pergunte o que a pessoa procura."
            hint="Usada quando NÃO há mensagem exata acima." />
        </div>
        <div className="mt-5">
          <MkButton onClick={saveAgent} disabled={savingTab === 'cerebro'}>
            {savingTab === 'cerebro' ? <Loader2 size={14} className="animate-spin" /> : null} Salvar
          </MkButton>
        </div>
      </ConfigSection>

      <ConhecimentoTab globalConfig={globalConfig} setGlobalConfig={setGlobalConfig} saveGlobal={saveGlobal} savingTab={savingTab} />
      <TomTab globalConfig={globalConfig} setGlobalConfig={setGlobalConfig} saveGlobal={saveGlobal} savingTab={savingTab} preview={preview} />
    </div>
  )
}

function ConhecimentoTab({
  globalConfig, setGlobalConfig, saveGlobal, savingTab,
}: {
  globalConfig: GlobalConfig; setGlobalConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>
  saveGlobal: (patch: Partial<GlobalConfig>, tabKey: string) => void; savingTab: string | null
}) {
  return (
    <div className="space-y-6">
      <ConfigSection title="O que o bot sabe" subtitle="Fatos que o bot pode usar como verdade — ele só afirma o que está aqui, não inventa."
        info={<>A base de fatos do bot (link do catálogo, prazo de entrega, garantia…). Um fato por linha. O bot trata isto como <strong>única fonte de verdade</strong>: usa quando faz sentido e <strong>não inventa</strong> o que não estiver aqui.</>}>
        <MkTextarea
          label="Conhecimento (link do catálogo, entrega, garantia…)"
          value={globalConfig.agentKnowledge ?? ''}
          onChange={v => setGlobalConfig(c => ({ ...c, agentKnowledge: v }))}
          rows={9}
          placeholder={'Ex:\n- Catálogo completo: https://...\n- Entrega: acesso na hora, por aqui mesmo\n- Garantia: 7 dias'}
          hint="Um fato por linha. O bot usa isso como única fonte de verdade: envia o link quando faz sentido e, se algo não estiver aqui, ele não inventa que “não existe” — guia a pessoa de outro jeito."
        />
        <div className="mt-5">
          <MkButton onClick={() => saveGlobal({ agentKnowledge: globalConfig.agentKnowledge }, 'conhecimento')} disabled={savingTab === 'conhecimento'}>
            {savingTab === 'conhecimento' ? <Loader2 size={14} className="animate-spin" /> : null} Salvar
          </MkButton>
        </div>
      </ConfigSection>
    </div>
  )
}

// ─── Tab: Tom ─────────────────────────────────────────────────────────────────

function TomTab({
  globalConfig, setGlobalConfig, saveGlobal, savingTab, preview,
}: {
  globalConfig: GlobalConfig; setGlobalConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>
  saveGlobal: (patch: Partial<GlobalConfig>, tabKey: string) => void; savingTab: string | null
  preview: PersonaPreview | null
}) {
  const set = (k: keyof GlobalConfig, v: unknown) => setGlobalConfig(c => ({ ...c, [k]: v }))
  const tone = globalConfig.agentTone ?? {}
  const setTone = (patch: Partial<AgentTone>) => setGlobalConfig(c => ({ ...c, agentTone: { ...c.agentTone, ...patch } }))
  const save = () => saveGlobal({
    assistantIdentityMode: globalConfig.assistantIdentityMode, assistantName: globalConfig.assistantName,
    companyName: globalConfig.companyName, neverExposeAI: globalConfig.neverExposeAI,
    allowIdentityDisclosure: globalConfig.allowIdentityDisclosure, locale: globalConfig.locale,
    tone: globalConfig.tone, agentTone: globalConfig.agentTone,
  }, 'tom')

  return (
    <div className="space-y-9">
      <ConfigSection title="Identidade" subtitle="Como o bot se apresenta. Voz neutra natural — humano de verdade, sem cara de bot."
        info={<><strong>Só marca</strong>: atende sem nome próprio (fala pela empresa). <strong>Com nome</strong>: usa um nome (ex: "Bia"). <strong>Nunca revelar que é IA</strong>: se perguntado, não admite ser robô. Vale tanto no Fluxo quanto no Agente.</>}>
        <div className="grid grid-cols-2 gap-5">
          <MkSelect label="Modo de identidade" value={globalConfig.assistantIdentityMode ?? 'brand_only'} onChange={v => set('assistantIdentityMode', v)}>
            <option value="brand_only">Só marca (sem nome)</option>
            <option value="named">Com nome (ex: Bia)</option>
          </MkSelect>
          <MkField label="Nome do assistente" value={globalConfig.assistantName ?? ''} onChange={v => set('assistantName', v)} placeholder="Bia" />
          <MkField label="Nome da empresa" value={globalConfig.companyName ?? ''} onChange={v => set('companyName', v)} placeholder="DramaHub" />
          <MkSelect label="Idioma" value={globalConfig.locale ?? 'pt-BR'} onChange={v => set('locale', v)}>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English (US)</option>
            <option value="es-ES">Español</option>
          </MkSelect>
          <ToggleRow on={globalConfig.neverExposeAI !== false} onChange={() => set('neverExposeAI', !(globalConfig.neverExposeAI !== false))}
            title="Nunca revelar que é IA" desc={globalConfig.neverExposeAI === false ? 'Pode revelar se perguntado' : 'Sempre nega ser IA'} />
        </div>
      </ConfigSection>

      <ConfigSection title="Tom de voz" subtitle="Knobs que calibram a voz natural do agente." badge="modo Agente"
        info={<>Ajustam como a <strong>IA</strong> escreve: formalidade, uso de emoji, tamanho das mensagens e gírias. A <strong>Prévia</strong> abaixo mostra exemplos reais. (Calibra o Agente; o Fluxo usa os textos fixos dos nós.)</>}>
        <div className="grid grid-cols-2 gap-5">
          <MkSelect label="Formalidade" value={tone.formality ?? 'neutro'} onChange={v => setTone({ formality: v as AgentTone['formality'] })}>
            <option value="informal">Informal</option>
            <option value="neutro">Neutro</option>
            <option value="formal">Formal</option>
          </MkSelect>
          <MkSelect label="Emoji" value={tone.emoji ?? 'raro'} onChange={v => setTone({ emoji: v as AgentTone['emoji'] })}>
            <option value="nenhum">Nenhum</option>
            <option value="raro">Raro</option>
            <option value="moderado">Moderado</option>
          </MkSelect>
          <MkSelect label="Tamanho das mensagens" value={tone.length ?? 'curtas'} onChange={v => setTone({ length: v as AgentTone['length'] })}>
            <option value="curtas">Curtas</option>
            <option value="medias">Médias</option>
          </MkSelect>
          <ToggleRow on={!!tone.slang} onChange={() => setTone({ slang: !tone.slang })}
            title="Gírias leves" desc={tone.slang ? 'Regionalismos permitidos' : 'Sem gírias'} />
        </div>
        <div className="mt-5">
          <MkButton onClick={save} disabled={savingTab === 'tom'}>
            {savingTab === 'tom' ? <Loader2 size={14} className="animate-spin" /> : null} Salvar tom
          </MkButton>
        </div>
      </ConfigSection>

      {preview && (
        <div>
          <Eyebrow className="block mb-3">Prévia</Eyebrow>
          <MkCard style={{ padding: 22 }}>
            <div className="space-y-3">
              <PreviewLine label="Identidade" text={preview.identityLine} />
              <PreviewLine label="Abertura" text={preview.greetingExample} />
              <PreviewLine label="Pagamento" text={preview.paymentExample} />
              <PreviewLine label="Handoff" text={preview.handoffExample} />
            </div>
          </MkCard>
        </div>
      )}
    </div>
  )
}

function PreviewLine({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <span className="mk-eyebrow" style={{ fontSize: '.56rem' }}>{label}</span>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem', marginTop: 2, fontStyle: 'italic' }}>“{text}”</p>
    </div>
  )
}

// ─── Tab: Automação (Flows) ───────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RuntimeSwitch({ value, onChange, saving }: { value: 'flow' | 'agent'; onChange: (v: 'flow' | 'agent') => void; saving: boolean }) {
  return (
    <div className="flex items-center rounded-full p-0.5" style={{ border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
      {(['flow', 'agent'] as const).map(mode => {
        const active = value === mode
        return (
          <button key={mode} onClick={() => !active && onChange(mode)} disabled={saving}
            className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5"
            style={active ? { background: 'var(--ink)', color: 'var(--paper)' } : { color: 'var(--muted)' }}>
            {saving && active ? <Loader2 size={11} className="animate-spin" /> : null}
            {mode === 'flow' ? 'Fluxo' : 'Agente'}
          </button>
        )
      })}
    </div>
  )
}

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

// Modal explicativo do escape hatch — ajuda o cliente a decidir se vale ligar (recomendação contextual).
function EscapeHatchHelp({ flowHasAI, onClose }: { flowHasAI: boolean; onClose: () => void }) {
  const liCls = 'flex gap-2'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,11,15,0.45)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="rounded-2xl" style={{ width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: 'var(--paper)', border: '1px solid var(--line)' }}>
        <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex-1">
            <Eyebrow>IA cobre lacunas</Eyebrow>
            <h2 className="mk-display" style={{ fontSize: '1.2rem', fontWeight: 700 }}>Vale a pena pro seu bot?</h2>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }} className="hover:opacity-60"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-5 text-sm" style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
          <p><strong>O que é:</strong> quando o cliente foge do roteiro (pergunta algo que o fluxo não previu), a IA responde — usando o seu <strong>Conhecimento</strong> — e <strong>devolve a conversa pro roteiro</strong>. Você descreve as partes; a IA cobre o resto. Custa <strong>1 chamada barata</strong>, e só quando sai do script (mensagem dentro do roteiro = zero IA).</p>
          <div>
            <p className="font-semibold mb-2" style={{ color: '#1d7a52' }}>✓ Vale a pena se…</p>
            <ul className="space-y-1.5">
              <li className={liCls}><span>•</span><span>seu fluxo é roteirizado e às vezes o cliente pergunta algo fora do script;</span></li>
              <li className={liCls}><span>•</span><span>você quer um toque de IA <strong>sem montar nós de IA</strong> no grafo;</span></li>
              <li className={liCls}><span>•</span><span>quer pagar IA só quando o cliente realmente foge do roteiro.</span></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-2" style={{ color: '#b42318' }}>✗ Provavelmente NÃO precisa se…</p>
            <ul className="space-y-1.5">
              <li className={liCls}><span>•</span><span>seu fluxo <strong>já tem IA própria</strong> (nós AI Router / Responder Dúvida) — ela já cobre o off-script;</span></li>
              <li className={liCls}><span>•</span><span>o bot está em <strong>modo Agente</strong> — aí a IA já é o cérebro inteiro.</span></li>
            </ul>
          </div>
          <div className="rounded-xl p-4" style={{ border: `1px solid ${flowHasAI ? 'rgba(180,35,24,0.25)' : 'rgba(29,122,82,0.25)'}`, background: flowHasAI ? 'rgba(180,35,24,0.06)' : 'rgba(29,122,82,0.06)' }}>
            <p className="mk-eyebrow mb-1" style={{ fontSize: '.6rem' }}>Pro seu bot</p>
            {flowHasAI
              ? <p>⚠️ Seu fluxo <strong>já tem IA própria</strong> (AI Router / Responder Dúvida) — ela já trata o off-script. Ligar isto adiciona uma <strong>segunda camada</strong> de IA (redundante). <strong>Provavelmente você não precisa.</strong></p>
              : <p>✅ Seu fluxo é <strong>determinístico</strong> (sem IA). Ligar isto dá a ele uma <strong>rede de IA</strong> pras perguntas fora do script — sem você montar nó nenhum.</p>}
          </div>
        </div>
        <div className="px-6 py-4 flex justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <MkButton onClick={onClose}>Entendi</MkButton>
        </div>
      </div>
    </div>
  )
}

function ConfigSection({ title, subtitle, info, badge, children }: { title: string; subtitle: string; info?: React.ReactNode; badge?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h2 className="mk-display" style={{ fontSize: '1.05rem', fontWeight: 600 }}>{title}</h2>
          {info && <InfoTip text={info} />}
          {badge && <span className="mk-eyebrow" style={{ fontSize: '.54rem', color: 'var(--muted)', border: '1px solid var(--line)', padding: '2px 7px', borderRadius: 999 }}>{badge}</span>}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: 2 }}>{subtitle}</p>
      </div>
      <MkCard style={{ padding: 22 }}>{children}</MkCard>
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
