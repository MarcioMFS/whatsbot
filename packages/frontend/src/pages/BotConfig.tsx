import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { ArrowLeft, Plus, ExternalLink, QrCode, Power, PowerOff, Loader2, Users, GitBranch, Trash2, Settings2, Activity, Package, ShoppingBag, Tag, PhoneCall } from 'lucide-react'
import { Layout } from '../components/ui/Layout.tsx'
import { GlassCard } from '../components/ui/GlassCard.tsx'
import { api } from '../api/client.ts'
import { useUIStore } from '../stores/uiStore.ts'

interface RoutingRule { tag: string; flowId: string }

interface GlobalConfig {
  defaultPixKey?: string
  defaultReceiverName?: string
  ownerPhone?: string
  supportFlowId?: string
  defaultCurrency?: string
  defaultPaymentExpirationMinutes?: number
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

export function BotConfig() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
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
  const { t } = useUIStore()

  useEffect(() => {
    if (!botId) return
    Promise.all([api.bots.get(botId), api.flows.list(botId), api.bots.connectionStatus(botId)]).then(([b, f, s]) => {
      const botData = b as BotData
      setBot(botData)
      setRoutingRules(botData.routingRules ?? [])
      setGlobalConfig(botData.globalConfig ?? {})
      setFlows(f as FlowData[])
      setWaState((s as { state: 'open' | 'connecting' | 'close' }).state)
    })
    if (headingRef.current) {
      gsap.fromTo(headingRef.current, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' })
    }
  }, [botId])

  // Poll connection status every 3s so UI reflects real state after QR scan
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

  const createFlow = async () => {
    if (!botId) return
    const name = prompt(`${t('flowName')}`)
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
        setQrError('QR code not ready yet. WhatsApp is connecting — try again in a few seconds.')
      } else {
        setQrCode(qr)
        setShowQR(true)
        setWaState('connecting')
      }
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Failed to load QR code')
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

  if (!bot) return null

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 ref={headingRef} className="text-2xl font-bold text-white">{bot.name}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{bot.productInfo.name}</p>
          </div>
          <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${
            bot.isActive
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
          }`}>
            {bot.isActive ? `● ${t('active')}` : `○ ${t('inactive')}`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <GlassCard animate delay={0}>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t('botInfo')}</h3>
            <dl className="space-y-2 text-sm">
              <Row label={t('aiProvider')} value={bot.aiConfig.provider} />
              <Row label={t('model')} value={bot.aiConfig.model} />
              <Row label={t('temperature')} value={String(bot.aiConfig.temperature)} />
              <Row label="Instance" value={bot.evolutionConfig.instanceName} />
              <Row label={t('language')} value={bot.productInfo.language} />
            </dl>
          </GlassCard>

          <GlassCard animate delay={0.08}>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t('whatsappConnection')}</h3>

            {/* Connection status badge */}
            <div className="flex items-center gap-2 mb-4">
              <span className={`w-2 h-2 rounded-full ${waState === 'open' ? 'bg-emerald-400' : waState === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
              <span className="text-sm text-slate-400">
                {waState === 'open' ? 'Connected' : waState === 'connecting' ? 'Connecting...' : waState === 'close' ? 'Disconnected' : '—'}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {waState === 'open' ? (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm px-4 py-2.5 rounded-xl">
                  <QrCode size={16} />
                  WhatsApp already connected
                </div>
              ) : (
                <button onClick={loadQR} disabled={qrLoading}
                  className="flex items-center gap-2 bg-glass-200 hover:bg-glass-300 disabled:opacity-50 border border-glass-border text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-all">
                  {qrLoading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                  {t('showQRCode')}
                </button>
              )}
              <a
                href="https://evolution.whatsbot.mfslabs.com.br/manager"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 bg-glass-100 hover:bg-glass-200 border border-glass-border text-slate-300 hover:text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-all"
              >
                <ExternalLink size={14} />
                Open Evolution Manager
              </a>
            </div>
            {qrError && (
              <div className="mt-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 space-y-1">
                <p>{qrError}</p>
                <p className="text-slate-500">Tip: use the Evolution Manager link above to connect manually — instance name: <span className="font-mono text-slate-300">{bot.evolutionConfig.instanceName}</span></p>
              </div>
            )}
            {showQR && qrCode && waState !== 'open' && (
              <div className="mt-4 p-3 bg-white rounded-xl inline-block">
                <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-40 h-40" />
              </div>
            )}
          </GlassCard>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{t('conversationFlows')}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(`/bots/${botId}/events`)}
              className="flex items-center gap-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
              <Activity size={14} />
              Eventos
            </button>
            <button onClick={() => navigate(`/bots/${botId}/leads`)}
              className="flex items-center gap-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
              <Users size={14} />
              Leads
            </button>
            <button onClick={() => navigate(`/bots/${botId}/products`)}
              className="flex items-center gap-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
              <Package size={14} />
              Produtos
            </button>
            <button onClick={() => navigate(`/bots/${botId}/orders`)}
              className="flex items-center gap-2 bg-lime-500/20 hover:bg-lime-500/30 border border-lime-500/30 text-lime-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
              <ShoppingBag size={14} />
              Pedidos
            </button>
            <button onClick={() => navigate(`/bots/${botId}/package-offers`)}
              className="flex items-center gap-2 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
              <Tag size={14} />
              Pacotes
            </button>
            <button onClick={() => navigate(`/bots/${botId}/handoffs`)}
              className="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
              <PhoneCall size={14} />
              Handoffs
            </button>
            <button onClick={createFlow}
            className="flex items-center gap-2 bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/30 text-brand-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
            <Plus size={14} />
            {t('newFlow')}
          </button>
          </div>
        </div>

        <div className="space-y-3">
          {flows.map((flow, i) => {
            const isActive = bot.isActive && bot.activeFlowId === flow.id
            return (
              <GlassCard key={flow.id} animate delay={0.1 + i * 0.06}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">{flow.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {(flow.nodes as unknown[]).length} {t('nodes')} · {(flow.edges as unknown[]).length} {t('connections')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleActive(flow.id)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
                          : 'bg-glass-100 text-slate-400 border-glass-border hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30'
                      }`}>
                      {isActive ? <><PowerOff size={12} />{t('deactivate')}</> : <><Power size={12} />{t('activate')}</>}
                    </button>
                    <button onClick={() => navigate(`/bots/${botId}/flow/${flow.id}`)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-glass-100 border border-glass-border text-slate-300 hover:text-white hover:bg-glass-200 transition-all">
                      <ExternalLink size={12} />
                      {t('edit')}
                    </button>
                  </div>
                </div>
              </GlassCard>
            )
          })}
        </div>

        {/* Global Config */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Settings2 size={16} className="text-brand-400" /> Configuração Global
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Valores padrão usados pelos nós do fluxo. Evitam reconfigurar em cada nó.</p>
            </div>
          </div>
          <div className="glass p-5 space-y-4 rounded-2xl border border-glass-border">
            <div className="grid grid-cols-2 gap-4">
              <ConfigField label="Chave Pix padrão" value={globalConfig.defaultPixKey ?? ''} onChange={v => setGlobalConfig(c => ({ ...c, defaultPixKey: v }))}
                placeholder="email@exemplo.com ou CPF" />
              <ConfigField label="Nome do favorecido padrão" value={globalConfig.defaultReceiverName ?? ''} onChange={v => setGlobalConfig(c => ({ ...c, defaultReceiverName: v }))}
                placeholder="João Silva" />
              <ConfigField label="Telefone do dono do bot" value={globalConfig.ownerPhone ?? ''} onChange={v => setGlobalConfig(c => ({ ...c, ownerPhone: v }))}
                placeholder="5511999999999" />
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Fluxo de suporte pós-compra</label>
                <select
                  value={globalConfig.supportFlowId ?? ''}
                  onChange={e => setGlobalConfig(c => ({ ...c, supportFlowId: e.target.value || undefined }))}
                  className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all"
                >
                  <option value="" className="bg-slate-900">Nenhum</option>
                  {flows.map(f => <option key={f.id} value={f.id} className="bg-slate-900">{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Moeda padrão</label>
                <select
                  value={globalConfig.defaultCurrency ?? 'BRL'}
                  onChange={e => setGlobalConfig(c => ({ ...c, defaultCurrency: e.target.value }))}
                  className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all"
                >
                  <option value="BRL" className="bg-slate-900">BRL (Real)</option>
                  <option value="USD" className="bg-slate-900">USD (Dólar)</option>
                  <option value="EUR" className="bg-slate-900">EUR (Euro)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Expiração de pagamento (minutos)</label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={globalConfig.defaultPaymentExpirationMinutes ?? 60}
                  onChange={e => setGlobalConfig(c => ({ ...c, defaultPaymentExpirationMinutes: Number(e.target.value) }))}
                  className="w-full bg-glass-100 border border-glass-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-all"
                />
              </div>
            </div>
            <button
              disabled={configSaving}
              onClick={async () => {
                if (!botId) return
                setConfigSaving(true)
                try { await api.bots.updateConfig(botId, globalConfig as Record<string, unknown>) } finally { setConfigSaving(false) }
              }}
              className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-5 py-2 rounded-xl transition-all disabled:opacity-50"
            >
              {configSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Salvar configuração
            </button>
          </div>
        </div>

        {/* Routing Rules */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <GitBranch size={16} className="text-brand-400" /> Roteamento por Tag
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Se o lead tiver a tag → usar esse fluxo. Ordem importa. Sem match → fluxo padrão.</p>
            </div>
            <button
              onClick={() => setRoutingRules(r => [...r, { tag: '', flowId: '' }])}
              className="flex items-center gap-2 bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/30 text-brand-400 text-sm font-medium px-4 py-2 rounded-xl transition-all"
            >
              <Plus size={14} /> Regra
            </button>
          </div>

          <div className="space-y-2">
            {routingRules.length === 0 && (
              <p className="text-slate-500 text-sm py-4 text-center glass">Nenhuma regra. Sempre usa o fluxo padrão.</p>
            )}
            {routingRules.map((rule, i) => (
              <div key={i} className="glass p-3 flex items-center gap-3">
                <span className="text-xs text-slate-500 w-5 text-center">{i + 1}</span>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-slate-400 shrink-0">Tag</span>
                  <input
                    value={rule.tag}
                    onChange={e => setRoutingRules(r => r.map((x, j) => j === i ? { ...x, tag: e.target.value } : x))}
                    placeholder="comprou"
                    className="bg-slate-800/60 border border-slate-700/50 text-slate-200 text-sm rounded-lg px-2 py-1 outline-none w-32"
                  />
                  <span className="text-xs text-slate-400 shrink-0">→ Fluxo</span>
                  <select
                    value={rule.flowId}
                    onChange={e => setRoutingRules(r => r.map((x, j) => j === i ? { ...x, flowId: e.target.value } : x))}
                    className="bg-slate-800/60 border border-slate-700/50 text-slate-300 text-sm rounded-lg px-2 py-1 outline-none flex-1"
                  >
                    <option value="">Selecionar...</option>
                    {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <button onClick={() => setRoutingRules(r => r.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {routingRules.length > 0 && (
            <button
              disabled={routingSaving}
              onClick={async () => {
                if (!botId) return
                setRoutingSaving(true)
                try { await api.bots.updateRoutingRules(botId, routingRules) } finally { setRoutingSaving(false) }
              }}
              className="mt-3 flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-5 py-2 rounded-xl transition-all disabled:opacity-50"
            >
              {routingSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Salvar regras
            </button>
          )}
        </div>
      </div>
    </Layout>
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

function ConfigField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
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
