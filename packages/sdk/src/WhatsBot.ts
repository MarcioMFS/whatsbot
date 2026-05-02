export interface WhatsBotConfig {
  /** Base URL of your WhatsBot backend */
  apiUrl: string
  /** Bot ID to embed */
  botId: string
  /** API token for authentication */
  apiKey?: string
  /** Container element ID to mount the iframe */
  containerId?: string
  /** iframe width (default: '100%') */
  width?: string
  /** iframe height (default: '700px') */
  height?: string
  /** Enable dark mode (default: true) */
  darkMode?: boolean
}

export class WhatsBot {
  private config: WhatsBotConfig
  private iframe: HTMLIFrameElement | null = null

  constructor(config: WhatsBotConfig) {
    this.config = config
  }

  static init(config: WhatsBotConfig): WhatsBot {
    const instance = new WhatsBot(config)
    if (config.containerId) {
      instance.mount(config.containerId)
    }
    return instance
  }

  mount(containerId: string): void {
    const container = document.getElementById(containerId)
    if (!container) throw new Error(`Container #${containerId} not found`)

    const { apiUrl, botId, apiKey, width = '100%', height = '700px', darkMode = true } = this.config

    const params = new URLSearchParams({
      embed: '1',
      ...(apiKey ? { token: apiKey } : {}),
      ...(darkMode ? { theme: 'dark' } : {}),
    })

    this.iframe = document.createElement('iframe')
    this.iframe.src = `${apiUrl}/embed/bot/${botId}?${params}`
    this.iframe.style.width = width
    this.iframe.style.height = height
    this.iframe.style.border = 'none'
    this.iframe.style.borderRadius = '16px'
    this.iframe.allow = 'clipboard-read; clipboard-write'

    container.appendChild(this.iframe)
    this.listenToMessages()
  }

  unmount(): void {
    this.iframe?.remove()
    this.iframe = null
    window.removeEventListener('message', this.handleMessage)
  }

  private listenToMessages(): void {
    window.addEventListener('message', this.handleMessage.bind(this))
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.config.apiUrl.startsWith(event.origin)) return
    const { type, payload } = event.data ?? {}
    if (type === 'whatsbot:ready') {
      this.iframe?.contentWindow?.postMessage({ type: 'whatsbot:config', payload: this.config }, this.config.apiUrl)
    }
  }

  /** Send a custom event to the embedded bot */
  send(event: string, data?: unknown): void {
    this.iframe?.contentWindow?.postMessage({ type: `whatsbot:${event}`, payload: data }, this.config.apiUrl)
  }
}

// Auto-initialize from data attributes
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const elements = document.querySelectorAll('[data-whatsbot]')
    elements.forEach(el => {
      const botId = el.getAttribute('data-whatsbot-id')
      const apiUrl = el.getAttribute('data-whatsbot-url')
      const apiKey = el.getAttribute('data-whatsbot-key') ?? undefined
      if (botId && apiUrl) {
        const instance = new WhatsBot({ botId, apiUrl, apiKey, containerId: el.id })
        instance.mount(el.id)
      }
    })
  })
}
