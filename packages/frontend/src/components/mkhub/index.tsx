import { useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, Info } from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────────
// MKHUB editorial primitives (monochrome paper / ink, Sora+Inter, soft cards).
// Tokens & base classes live in globals.css under the `.mkhub` scope.
// ──────────────────────────────────────────────────────────────────────────────

export function MkPage({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`mkhub min-h-screen ${className}`} style={style}>{children}</div>
}

export function Eyebrow({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={`mk-eyebrow ${className}`} style={style}>{children}</span>
}

export function Display({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={`mk-display ${className}`} style={style}>{children}</span>
}

// Ícone "i" com tooltip no hover — explica um conceito sem poluir a tela.
// Reutilizável em qualquer tela da plataforma.
export function InfoTip({ text, width = 260, side = 'top' }: { text: ReactNode; width?: number; side?: 'top' | 'bottom' }) {
  const [open, setOpen] = useState(false)
  const pos: CSSProperties = side === 'bottom'
    ? { top: 'calc(100% + 8px)' }
    : { bottom: 'calc(100% + 8px)' }
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onClick={e => { e.stopPropagation(); setOpen(o => !o) }}>
      <Info size={13} strokeWidth={1.8} style={{ color: 'var(--muted)', cursor: 'help', flexShrink: 0 }} />
      {open && (
        <span role="tooltip" style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)', ...pos,
          width, zIndex: 60, background: 'var(--ink)', color: 'var(--paper)',
          padding: '9px 12px', borderRadius: 9, fontSize: '.72rem', lineHeight: 1.5,
          fontWeight: 400, letterSpacing: 0, textAlign: 'left', whiteSpace: 'normal',
          boxShadow: '0 8px 24px rgba(10,10,10,.22)', pointerEvents: 'none',
        }}>{text}</span>
      )}
    </span>
  )
}

export function MkCard({ children, hover = false, className = '', style, onClick }: {
  children: ReactNode; hover?: boolean; className?: string; style?: CSSProperties; onClick?: () => void
}) {
  return (
    <div className={`mk-card ${hover ? 'mk-card-hover' : ''} ${onClick ? 'cursor-pointer' : ''} ${className}`} style={style} onClick={onClick}>
      {children}
    </div>
  )
}

export function MkButton({ children, onClick, type = 'button', variant = 'solid', disabled, className = '' }: {
  children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; variant?: 'solid' | 'ghost' | 'link'; disabled?: boolean; className?: string
}) {
  if (variant === 'link') {
    return (
      <button type={type} onClick={onClick} disabled={disabled}
        className={`mk-link inline-flex items-center gap-1.5 text-sm disabled:opacity-50 ${className}`}
        style={{ color: 'var(--ink)' }}>
        {children} <ArrowRight size={13} strokeWidth={2} />
      </button>
    )
  }
  const solid = variant === 'solid'
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all disabled:opacity-50 ${className}`}
      style={solid
        ? { background: 'var(--ink)', color: 'var(--paper)', padding: '11px 22px' }
        : { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '10px 21px' }}>
      {children}
    </button>
  )
}

export function MkSwitch({ on, onChange, label }: { on: boolean; onChange: () => void; label?: string }) {
  return (
    <button onClick={onChange} aria-label={label ?? 'toggle'}
      style={{
        width: 46, height: 26, borderRadius: 999, padding: 3, cursor: 'pointer',
        border: '1px solid var(--line)', background: on ? 'var(--ink)' : 'transparent',
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background .3s ease',
      }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--paper-2)', boxShadow: '0 2px 6px rgba(10,10,10,.25)', transition: 'transform .3s cubic-bezier(.16,1,.3,1)' }} />
    </button>
  )
}

export function SectionLabel({ n, title, hint }: { n?: string; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-7">
      {n && <span className="mk-display" style={{ fontSize: '.85rem', color: 'var(--muted)', fontWeight: 600 }}>{n}</span>}
      <h2 className="mk-display" style={{ fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h2>
      {hint && <span className="mk-eyebrow" style={{ marginLeft: 'auto' }}>{hint}</span>}
    </div>
  )
}

export function Sculpt({ size, style }: { size: number; style?: CSSProperties }) {
  return <div className="mk-sculpt" style={{ width: size, height: size, ...style }} />
}

export function MkField({ label, type = 'text', value, onChange, placeholder }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mk-input w-full px-4 py-3 text-sm" />
    </div>
  )
}

export function MkTextarea({ label, value, onChange, placeholder, rows = 5, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; hint?: string
}) {
  return (
    <div>
      <label className="mk-eyebrow block mb-2" style={{ fontSize: '.62rem' }}>{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="mk-input w-full px-4 py-3 text-sm" style={{ resize: 'vertical', lineHeight: 1.5 }} />
      {hint && <p className="mt-1.5 text-xs opacity-60" style={{ lineHeight: 1.45 }}>{hint}</p>}
    </div>
  )
}
