import { useEffect, useRef } from 'react'
import gsap from 'gsap'

interface GlassCardProps {
  children: React.ReactNode
  className?: string
  animate?: boolean
  delay?: number
  onClick?: () => void
}

export function GlassCard({ children, className = '', animate = false, delay = 0, onClick }: GlassCardProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!animate || !ref.current) return
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 24, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, delay, ease: 'power3.out' }
    )
  }, [animate, delay])

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`glass glass-hover p-6 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ willChange: 'transform' }}
    >
      {children}
    </div>
  )
}
