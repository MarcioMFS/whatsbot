import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          900: '#0c4a6e',
        },
        glass: {
          100: 'rgba(255,255,255,0.05)',
          200: 'rgba(255,255,255,0.08)',
          300: 'rgba(255,255,255,0.12)',
          border: 'rgba(255,255,255,0.12)',
        },
      },
      backgroundImage: {
        'radial-dark': 'radial-gradient(ellipse at top, #0f172a 0%, #020617 100%)',
        'glow-brand': 'radial-gradient(circle at center, rgba(14,165,233,0.15) 0%, transparent 70%)',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
        'glass-lg': '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
        'glow-sm': '0 0 20px rgba(14,165,233,0.3)',
        'glow-md': '0 0 40px rgba(14,165,233,0.4)',
      },
    },
  },
  plugins: [],
} satisfies Config
