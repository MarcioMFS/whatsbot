import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { Plus, Bot, Activity, Zap, MessageSquare } from 'lucide-react'
import { MkLayout } from '../components/mkhub/MkLayout.tsx'
import { MkCard, MkButton, Eyebrow, Sculpt } from '../components/mkhub'
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
      gsap.fromTo(headingRef.current, { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' })
    }
  }, [])

  const handleBotCreated = (bot: unknown) => {
    setBots(prev => [bot as BotData, ...prev])
    setShowCreate(false)
  }

  return (
    <MkLayout>
      <Sculpt size={300} style={{ top: -130, right: -90, opacity: 0.6 }} />
      <div className="max-w-6xl mx-auto" style={{ position: 'relative' }}>
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="stripe" style={{ width: 36, height: 3, background: 'var(--ink)' }} />
              <Eyebrow>Seus bots</Eyebrow>
            </div>
            <h1 ref={headingRef} className="mk-display" style={{ fontSize: 'clamp(2rem,4vw,2.8rem)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
              {t('yourBots')}
            </h1>
            <p style={{ color: 'var(--muted)', marginTop: 12 }}>{t('manageBotsDesc')}</p>
          </div>
          <MkButton onClick={() => setShowCreate(true)}>
            <Plus size={16} /> {t('newBot')}
          </MkButton>
        </div>

        {bots.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {bots.map(bot => (
              <MkCard key={bot.id} hover onClick={() => navigate(`/bots/${bot.id}/config`)} style={{ padding: 24 }}>
                <div className="flex items-start justify-between mb-5">
                  <div style={{ width: 44, height: 44, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Bot size={19} strokeWidth={1.6} />
                  </div>
                  <span className="text-xs font-semibold" style={bot.isActive
                    ? { background: 'var(--ink)', color: 'var(--paper)', padding: '4px 12px', borderRadius: 999 }
                    : { border: '1px solid var(--line)', color: 'var(--muted)', padding: '3px 11px', borderRadius: 999 }}>
                    {bot.isActive ? t('active') : t('inactive')}
                  </span>
                </div>
                <h3 className="mk-display" style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: 4 }}>{bot.name}</h3>
                <p className="text-sm" style={{ color: 'var(--muted)', marginBottom: 18 }}>{bot.productInfo.name}</p>
                <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5"><Zap size={12} strokeWidth={1.8} /> {bot.aiConfig.provider}</span>
                  <span className="flex items-center gap-1.5"><Activity size={12} strokeWidth={1.8} /> {bot.evolutionConfig.instanceName}</span>
                </div>
              </MkCard>
            ))}
          </div>
        )}
      </div>

      {showCreate && <CreateBotModal onClose={() => setShowCreate(false)} onCreated={handleBotCreated} />}
    </MkLayout>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useUIStore()
  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(ref.current, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out' })
  }, [])
  return (
    <div ref={ref}>
      <MkCard style={{ padding: '72px 32px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <MessageSquare size={26} strokeWidth={1.5} />
        </div>
        <h3 className="mk-display" style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 8 }}>{t('noBots')}</h3>
        <p style={{ color: 'var(--muted)', maxWidth: 360, margin: '0 auto 24px' }}>{t('noBotsDesc')}</p>
        <MkButton onClick={onCreate}>{t('createFirstBot')}</MkButton>
      </MkCard>
    </div>
  )
}
