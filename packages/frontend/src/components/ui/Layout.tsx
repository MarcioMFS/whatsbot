import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Bot, LogOut, LayoutDashboard, GitBranch, Users, Package,
  ShoppingBag, Tag, PhoneCall, CreditCard, Settings2, ChevronRight,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore.ts'
import { useUIStore } from '../../stores/uiStore.ts'

interface BotNavItem {
  label: string
  icon: React.ElementType
  href: string        // path segment or 'config'
  tab?: string        // ?tab= param (only when href === 'config')
}

const BOT_NAV: BotNavItem[] = [
  { label: 'Visão Geral',   icon: LayoutDashboard, href: 'config' },
  { label: 'Flows',         icon: GitBranch,       href: 'config', tab: 'automacao' },
  { label: 'Leads',         icon: Users,           href: 'leads' },
  { label: 'Produtos',      icon: Package,         href: 'products' },
  { label: 'Pedidos',       icon: ShoppingBag,     href: 'orders' },
  { label: 'Pacotes',       icon: Tag,             href: 'package-offers' },
  { label: 'Handoffs',      icon: PhoneCall,       href: 'handoffs' },
  { label: 'Pagamentos',    icon: CreditCard,      href: 'payment-intents' },
  { label: 'Configurações', icon: Settings2,       href: 'config', tab: 'configuracoes' },
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
    if (!item.tab) {
      // "Visão Geral" — ativo quando sem tab ou tab desconhecida
      return !tab || !['automacao', 'configuracoes'].includes(tab)
    }
    return tab === item.tab
  }

  return pathname === `/bots/${botId}/${item.href}`
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const { locale, setLocale, t, currentBot } = useUIStore()
  const location = useLocation()
  const navigate = useNavigate()

  // Detecta se está dentro de um bot pelo pathname
  const botMatch = /^\/bots\/([^/]+)/.exec(location.pathname)
  const activeBotId = botMatch?.[1] ?? null

  return (
    <div className="min-h-screen bg-radial-dark flex">
      <aside className="w-56 border-r border-glass-border glass flex flex-col shrink-0" style={{ borderRadius: 0 }}>
        {/* Logo */}
        <div className="p-5 border-b border-glass-border">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center shadow-glow-sm">
                <Bot size={14} className="text-white" />
              </div>
              <span className="font-semibold text-white glow-text text-sm">WhatsBot</span>
            </button>
            <button
              onClick={() => setLocale(locale === 'en' ? 'pt-BR' : 'en')}
              className="text-xs font-medium px-1.5 py-0.5 rounded-md bg-glass-200 border border-glass-border text-slate-400 hover:text-white transition-all"
            >
              {locale === 'en' ? 'PT' : 'EN'}
            </button>
          </div>
        </div>

        {/* Nav principal */}
        <nav className="flex-1 p-3 overflow-y-auto space-y-0.5">
          <NavItem
            to="/"
            icon={<LayoutDashboard size={14} />}
            label={t('dashboard')}
            active={location.pathname === '/'}
          />

          {/* Seção do bot ativo */}
          {activeBotId && (
            <div className="mt-4">
              <div className="px-2 pb-1.5 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest truncate">
                  {currentBot?.name ?? 'Bot'}
                </span>
              </div>
              {BOT_NAV.map(item => {
                const active = isBotNavActive(item, activeBotId, location.pathname, location.search)
                const to = botNavTo(activeBotId, item)
                return (
                  <NavItem
                    key={item.label}
                    to={to}
                    icon={<item.icon size={14} />}
                    label={item.label}
                    active={active}
                    indent
                  />
                )
              })}
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-glass-border">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-full bg-glass-300 flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user?.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-slate-500 hover:text-white text-xs transition-colors w-full"
          >
            <LogOut size={12} />
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

function NavItem({
  to, icon, label, active, indent = false,
}: {
  to: string
  icon: React.ReactNode
  label: string
  active: boolean
  indent?: boolean
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-all duration-200 group ${
        indent ? 'ml-1' : ''
      } ${
        active
          ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
          : 'text-slate-400 hover:text-white hover:bg-glass-200 border border-transparent'
      }`}
    >
      <span className={active ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300'}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {active && <ChevronRight size={10} className="text-brand-400/60 shrink-0" />}
    </Link>
  )
}
