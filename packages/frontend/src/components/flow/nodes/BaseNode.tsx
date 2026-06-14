import { useEffect, useRef } from 'react'
import { Handle, Position } from '@xyflow/react'
import gsap from 'gsap'

interface BaseNodeProps {
  selected?: boolean
  children: React.ReactNode
  color: string
  borderColor: string
  handles?: {
    inputs?: Array<{ id?: string; label?: string }>
    outputs?: Array<{ id?: string; label?: string; color?: string }>
  }
}

export function BaseNode({ selected, children, color, borderColor, handles }: BaseNodeProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(ref.current,
      { opacity: 0, scale: 0.9, y: 10 },
      { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: 'back.out(1.4)' }
    )
  }, [])

  return (
    <div
      ref={ref}
      className={`min-w-[180px] max-w-[220px] rounded-2xl border backdrop-blur-xl transition-all duration-200 ${
        selected ? `${borderColor} shadow-glow-sm` : 'border-white/10'
      }`}
      style={{
        background: `linear-gradient(135deg, ${color} 0%, rgba(2,6,23,0.9) 100%)`,
        boxShadow: selected
          ? '0 0 30px rgba(14,165,233,0.3), 0 8px 32px rgba(0,0,0,0.4)'
          : '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
        willChange: 'transform',
      }}
    >
      {handles?.inputs?.map((h, i) => (
        <Handle
          key={h.id ?? i}
          type="target"
          position={Position.Top}
          id={h.id}
          style={{ top: -5 }}
        />
      ))}
      <div className="p-3">{children}</div>
      {handles?.outputs?.map((h, i) => {
        const n = handles.outputs!.length
        // Spread multiple outputs evenly across the bottom edge instead of stacking them at 50%
        const left = n === 1 ? 50 : ((i + 1) / (n + 1)) * 100
        const bg = h.color && h.color.startsWith('rgba') ? h.color : 'rgba(14,165,233,0.85)'
        return (
          <div key={h.id ?? i}>
            <Handle
              type="source"
              position={Position.Bottom}
              id={h.id}
              style={{ bottom: -5, left: `${left}%`, background: bg }}
            />
            {n > 1 && h.label && (
              <span
                className="absolute text-[8px] leading-none text-white/45 whitespace-nowrap pointer-events-none"
                style={{ bottom: -15, left: `${left}%`, transform: 'translateX(-50%)' }}
              >
                {h.label}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
