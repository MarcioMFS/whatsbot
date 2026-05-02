import { Link, useLocation } from 'react-router-dom'
import { Bot, LogOut, LayoutDashboard } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore.ts'
import { useUIStore } from '../../stores/uiStore.ts'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const { locale, setLocale, t } = useUIStore()
  const location = useLocation()

  return (
    <div className="min-h-screen bg-radial-dark flex">
      <aside className="w-64 border-r border-glass-border glass flex flex-col" style={{ borderRadius: 0 }}>
        <div className="p-6 border-b border-glass-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shadow-glow-sm">
                <Bot size={16} className="text-white" />
              </div>
              <span className="font-semibold text-white glow-text">WhatsBot</span>
            </div>
            {/* Language toggle */}
            <button
              onClick={() => setLocale(locale === 'en' ? 'pt-BR' : 'en')}
              className="text-xs font-medium px-2 py-1 rounded-lg bg-glass-200 border border-glass-border text-slate-300 hover:text-white hover:border-brand-500/40 transition-all"
            >
              {locale === 'en' ? '🇧🇷 PT' : '🇺🇸 EN'}
            </button>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <NavItem to="/" icon={<LayoutDashboard size={16} />} label={t('dashboard')} active={location.pathname === '/'} />
        </nav>

        <div className="p-4 border-t border-glass-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-glass-300 flex items-center justify-center text-xs font-semibold text-white">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full"
          >
            <LogOut size={14} />
            {t('signOut')}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}

function NavItem({ to, icon, label, active }: { to: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
        active
          ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
          : 'text-slate-400 hover:text-white hover:bg-glass-200'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}
