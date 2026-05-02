import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { Zap, Bot, MessageSquare, GitBranch, Clipboard, Globe, Clock, XCircle } from 'lucide-react'

const NODE_TYPES = [
  { type: 'text_message', label: 'Text Message', icon: MessageSquare, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  { type: 'ai_response', label: 'AI Response', icon: Bot, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
  { type: 'condition', label: 'Condition', icon: GitBranch, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  { type: 'capture', label: 'Capture Input', icon: Clipboard, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  { type: 'webhook', label: 'Webhook', icon: Globe, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  { type: 'delay', label: 'Delay', icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  { type: 'end', label: 'End', icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
]

interface Props {
  onAdd: (type: string) => void
}

export function NodePalette({ onAdd }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll('[data-node-item]')
    gsap.fromTo(items,
      { opacity: 0, x: -16 },
      { opacity: 1, x: 0, duration: 0.4, stagger: 0.07, ease: 'power3.out', delay: 0.2 }
    )
  }, [])

  return (
    <aside className="w-56 border-r border-glass-border flex flex-col glass" style={{ borderRadius: 0 }}>
      <div className="p-4 border-b border-glass-border">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-brand-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Nodes</span>
        </div>
      </div>
      <div ref={listRef} className="p-3 space-y-1 overflow-y-auto">
        {NODE_TYPES.map(({ type, label, icon: Icon, color, bg }) => (
          <button
            key={type}
            data-node-item
            onClick={() => onAdd(type)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${bg} ${color}`}
            style={{ willChange: 'transform' }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div className="p-4 border-t border-glass-border mt-auto">
        <p className="text-xs text-slate-500 leading-relaxed">Click a node type to add it to the canvas. Drag to reposition.</p>
      </div>
    </aside>
  )
}
