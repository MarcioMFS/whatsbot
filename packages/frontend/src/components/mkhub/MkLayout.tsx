import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LogOut, LayoutDashboard, GitBranch, Users,
  ShoppingBag, PhoneCall, Settings2,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore.ts'
import { useUIStore } from '../../stores/uiStore.ts'

interface BotNavItem { label: string; icon: React.ElementType; href: string; tab?: string }

const BOT_NAV: BotNavItem[] = [
  { label: 'Visão Geral',   icon: LayoutDashboard, href: 'config' },
  { label: 'Flows',         icon: GitBranch,       href: 'config', tab: 'automacao' },
  { label: 'Leads',         icon: Users,           href: 'leads' },
  { label: 'Vendas',        icon: ShoppingBag,     href: 'sales' },
  { label: 'Handoffs',      icon: PhoneCall,       href: 'handoffs' },
  { label: 'Configurações', icon: Settings2,       href: 'config', tab: 'config' },
]

function botNavTo(botId: string, item: BotNavItem): string {
  const base = `/bots/${botId}/${item.href}`
  return item.tab ? `${base}?tab=${item.tab}` : base
}

function isBotNavActive(item: BotNavItem, botId: string, pathname: string, search: string): boolean {
  const configPath = `/bots/${botId}/config`
  const tab = new URLSearchParams(search).get('tab')
  if (item.href === 'config') {
    if (pathname !== configPath) return false
    if (!item.tab) return !tab || !['automacao', 'config', 'modulos', 'skills', 'conhecimento', 'tom'].includes(tab)
    return tab === item.tab
  }
  return pathname === `/bots/${botId}/${item.href}`
}

export function MkLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const { locale, setLocale, t, currentBot } = useUIStore()
  const location = useLocation()
  const navigate = useNavigate()

  const botMatch = /^\/bots\/([^/]+)/.exec(location.pathname)
  const activeBotId = botMatch?.[1] ?? null

  return (
    <div className="mkhub flex min-h-screen">
      <aside className="w-60 shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--line)', background: 'var(--paper-2)' }}>
        {/* Wordmark */}
        <div className="flex items-center justify-between px-6 py-6" style={{ borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => navigate('/')} className="mk-display" style={{ fontWeight: 700, letterSpacing: '.16em', fontSize: '.95rem', color: 'var(--ink)' }}>
            WHATSBOT
          </button>
          <button
            onClick={() => setLocale(locale === 'en' ? 'pt-BR' : 'en')}
            className="text-[11px] font-semibold px-2 py-1 rounded-full"
            style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}
          >
            {locale === 'en' ? 'PT' : 'EN'}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <MkNavItem to="/" icon={<LayoutDashboard size={15} strokeWidth={1.7} />} label={t('dashboard')} active={location.pathname === '/'} />

          {activeBotId && (
            <div className="mt-6">
              <div className="px-3 pb-2">
                <span className="mk-eyebrow" style={{ fontSize: '.58rem' }}>{currentBot?.name ?? 'Bot'}</span>
              </div>
              {BOT_NAV.map(item => (
                <MkNavItem
                  key={item.label}
                  to={botNavTo(activeBotId, item)}
                  icon={<item.icon size={15} strokeWidth={1.7} />}
                  label={item.label}
                  active={isBotNavActive(item, activeBotId, location.pathname, location.search)}
                />
              ))}
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="shrink-0 flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', fontSize: '.72rem', fontWeight: 600 }}>
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>{user?.name}</p>
              <p className="text-[10px] truncate" style={{ color: 'var(--muted)' }}>{user?.email}</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-2 text-xs w-full" style={{ color: 'var(--muted)' }}>
            <LogOut size={13} /> {t('signOut')}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto" style={{ position: 'relative' }}>
        <div className="px-10 py-10">{children}</div>
      </main>
    </div>
  )
}

function MkNavItem({ to, icon, label, active }: { to: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] transition-all duration-200"
      style={active
        ? { background: 'rgba(10,10,10,0.06)', color: 'var(--ink)', fontWeight: 600 }
        : { color: 'var(--muted)', fontWeight: 500 }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--ink)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--muted)' }}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink)' }} />}
    </Link>
  )
}
