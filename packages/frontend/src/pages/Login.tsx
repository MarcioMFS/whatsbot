import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { api } from '../api/client.ts'
import { useAuthStore } from '../stores/authStore.ts'
import { useUIStore } from '../stores/uiStore.ts'
import { MkPage, MkCard, MkField, MkButton, Eyebrow, Display, Sculpt } from '../components/mkhub'

export function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const { setAuth, token } = useAuthStore()
  const { locale, setLocale, t } = useUIStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (token) navigate('/')
  }, [token, navigate])

  useEffect(() => {
    if (!cardRef.current) return
    gsap.fromTo(cardRef.current,
      { opacity: 0, y: 40, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out' }
    )
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = mode === 'login'
        ? await api.auth.login(email, password)
        : await api.auth.register(email, password, name)
      setAuth(res.token, res.user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <MkPage className="flex items-center justify-center p-4" style={{ position: 'relative', overflow: 'hidden' }}>
      <Sculpt size={420} style={{ top: -160, right: -120, opacity: 0.7 }} />
      <Sculpt size={220} style={{ bottom: -60, left: -80, opacity: 0.5 }} />

      <div ref={cardRef} style={{ width: '100%', maxWidth: 440, position: 'relative' }}>
        <MkCard style={{ padding: 40 }}>
          {/* Wordmark + locale */}
          <div className="flex items-center justify-between mb-10">
            <div>
              <Display style={{ fontWeight: 700, letterSpacing: '.18em', fontSize: '1.1rem' }}>WHATSBOT</Display>
              <Eyebrow className="block mt-1.5">{t('aiPowered')}</Eyebrow>
            </div>
            <button
              onClick={() => setLocale(locale === 'en' ? 'pt-BR' : 'en')}
              className="text-xs font-medium px-3 py-1.5 rounded-full"
              style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}
            >
              {locale === 'en' ? '🇧🇷 PT' : '🇺🇸 EN'}
            </button>
          </div>

          <h1 className="mk-display mb-8" style={{ fontSize: '1.9rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {mode === 'login' ? t('welcomeBack') : t('createAccount')}
          </h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && (
              <MkField label={t('name')} type="text" value={name} onChange={setName} placeholder={t('yourName')} />
            )}
            <MkField label={t('email')} type="email" value={email} onChange={setEmail} placeholder="voce@exemplo.com" />
            <MkField label={t('password')} type="password" value={password} onChange={setPassword} placeholder="••••••••" />

            {error && (
              <p className="text-sm rounded-xl px-3 py-2.5" style={{ color: '#b42318', background: 'rgba(180,35,24,0.07)', border: '1px solid rgba(180,35,24,0.18)' }}>
                {error}
              </p>
            )}

            <MkButton type="submit" disabled={loading} className="w-full" >
              {loading ? t('loading') : mode === 'login' ? t('signIn') : t('signUp')}
            </MkButton>
          </form>

          <p className="text-center text-sm mt-7" style={{ color: 'var(--muted)' }}>
            {mode === 'login' ? t('noAccount') : t('alreadyAccount')}{' '}
            <button
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="mk-link"
              style={{ color: 'var(--ink)' }}
            >
              {mode === 'login' ? t('signUp') : t('signIn')}
            </button>
          </p>
        </MkCard>
      </div>
    </MkPage>
  )
}
