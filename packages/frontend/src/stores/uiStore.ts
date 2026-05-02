import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Locale } from '../i18n/index.ts'
import { translations } from '../i18n/index.ts'

interface UIState {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: keyof typeof translations.en) => string
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      locale: 'en',
      setLocale: (locale) => set({ locale }),
      t: (key) => translations[get().locale][key] ?? translations.en[key] ?? key,
    }),
    { name: 'whatsbot-ui' }
  )
)
