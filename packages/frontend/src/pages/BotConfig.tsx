import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { ArrowLeft, Plus, ExternalLink, QrCode, Power, PowerOff, Loader2 } from 'lucide-react'
import { Layout } from '../components/ui/Layout.tsx'
import { GlassCard } from '../components/ui/GlassCard.tsx'
import { api } from '../api/client.ts'
import { useUIStore } from '../stores/uiStore.ts'

interface BotData {
  id: string
  name: string
  isActive: boolean
  activeFlowId: string | null
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
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { t } = useUIStore()

  useEffect(() => {
    if (!botId) return
    Promise.all([api.bots.get(botId), api.flows.list(botId)]).then(([b, f]) => {
      setBot(b as BotData)
      setFlows(f as FlowData[])
    })
    if (headingRef.current) {
      gsap.fromTo(headingRef.current, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' })
    }
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
            <p className="text-sm text-slate-400 mb-4">{t('scanQR')}</p>
            <div className="flex flex-col gap-2">
              <button onClick={loadQR} disabled={qrLoading}
                className="flex items-center gap-2 bg-glass-200 hover:bg-glass-300 disabled:opacity-50 border border-glass-border text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-all">
                {qrLoading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                {t('showQRCode')}
              </button>
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
            {showQR && qrCode && (
              <div className="mt-4 p-3 bg-white rounded-xl inline-block">
                <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-40 h-40" />
              </div>
            )}
          </GlassCard>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{t('conversationFlows')}</h2>
          <button onClick={createFlow}
            className="flex items-center gap-2 bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/30 text-brand-400 text-sm font-medium px-4 py-2 rounded-xl transition-all">
            <Plus size={14} />
            {t('newFlow')}
          </button>
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
