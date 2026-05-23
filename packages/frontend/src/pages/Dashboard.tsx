import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { Plus, Bot, Activity, Zap, MessageSquare } from 'lucide-react'
import { Layout } from '../components/ui/Layout.tsx'
import { GlassCard } from '../components/ui/GlassCard.tsx'
import { api } from '../api/client.ts'
import { CreateBotModal } from '../components/bot/CreateBotModal.tsx'
import { useUIStore } from '../stores/uiStore.ts'

interface BotData {
  id: string
  name: string
  isActive: boolean
  productInfo: { name: string }
  aiConfig: { provider: string }
  evolutionConfig: { instanceName: string }
}

export function Dashboard() {
  const [bots, setBots] = useState<BotData[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()
  const { t } = useUIStore()

  useEffect(() => {
    api.bots.list().then(data => setBots(data as BotData[]))
    if (headingRef.current) {
      gsap.fromTo(headingRef.current,
        { opacity: 0, y: -20 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }
      )
    }
  }, [])

  const handleBotCreated = (bot: unknown) => {
    setBots(prev => [bot as BotData, ...prev])
    setShowCreate(false)
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 ref={headingRef} className="text-3xl font-bold text-white">{t('yourBots')}</h1>
            <p className="text-slate-400 mt-1">{t('manageBotsDesc')}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-medium px-5 py-2.5 rounded-xl transition-all duration-200 shadow-glow-sm hover:shadow-glow-md"
          >
            <Plus size={16} />
            {t('newBot')}
          </button>
        </div>

        {bots.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bots.map((bot, i) => (
              <GlassCard key={bot.id} animate delay={i * 0.08} onClick={() => navigate(`/bots/${bot.id}/config`)}>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
                    <Bot size={18} className="text-brand-400" />
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    bot.isActive
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                  }`}>
                    {bot.isActive ? t('active') : t('inactive')}
                  </span>
                </div>
                <h3 className="font-semibold text-white mb-1">{bot.name}</h3>
                <p className="text-sm text-slate-400 mb-4">{bot.productInfo.name}</p>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Zap size={12} className="text-brand-400" />
                    {bot.aiConfig.provider}
                  </span>
                  <span className="flex items-center gap-1">
                    <Activity size={12} />
                    {bot.evolutionConfig.instanceName}
                  </span>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateBotModal onClose={() => setShowCreate(false)} onCreated={handleBotCreated} />
      )}
    </Layout>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useUIStore()

  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(ref.current, { opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out' })
  }, [])

  return (
    <div ref={ref} className="glass text-center py-20 px-8">
      <div className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-4">
        <MessageSquare size={28} className="text-brand-400" />
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">{t('noBots')}</h3>
      <p className="text-slate-400 mb-6 max-w-sm mx-auto">{t('noBotsDesc')}</p>
      <button
        onClick={onCreate}
        className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-2.5 rounded-xl transition-all duration-200 shadow-glow-sm"
      >
        {t('createFirstBot')}
      </button>
    </div>
  )
}
