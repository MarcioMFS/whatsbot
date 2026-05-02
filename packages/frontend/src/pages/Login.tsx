import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { Bot } from 'lucide-react'
import { api } from '../api/client.ts'
import { useAuthStore } from '../stores/authStore.ts'
import { useUIStore } from '../stores/uiStore.ts'

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
      { opacity: 0, y: 40, scale: 0.95 },
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
    <div className="min-h-screen bg-radial-dark flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-glow-brand pointer-events-none" />

      <div ref={cardRef} className="glass w-full max-w-md p-8" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shadow-glow-sm">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white glow-text">WhatsBot</h1>
              <p className="text-xs text-slate-400">{t('aiPowered')}</p>
            </div>
          </div>
          <button
            onClick={() => setLocale(locale === 'en' ? 'pt-BR' : 'en')}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-glass-200 border border-glass-border text-slate-300 hover:text-white transition-all"
          >
            {locale === 'en' ? '🇧🇷 PT' : '🇺🇸 EN'}
          </button>
        </div>

        <h2 className="text-lg font-semibold text-white mb-6">
          {mode === 'login' ? t('welcomeBack') : t('createAccount')}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <Input label={t('name')} type="text" value={name} onChange={setName} placeholder={t('yourName')} />
          )}
          <Input label={t('email')} type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
          <Input label={t('password')} type="password" value={password} onChange={setPassword} placeholder="••••••••" />

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-xl transition-all duration-200 shadow-glow-sm hover:shadow-glow-md"
          >
            {loading ? t('loading') : mode === 'login' ? t('signIn') : t('signUp')}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400 mt-6">
          {mode === 'login' ? t('noAccount') : t('alreadyAccount')}{' '}
          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
          >
            {mode === 'login' ? t('signUp') : t('signIn')}
          </button>
        </p>
      </div>
    </div>
  )
}

function Input({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string
  onChange: (v: string) => void; placeholder: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-glass-100 border border-glass-border rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 transition-all"
      />
    </div>
  )
}
