import type { MessagingPort, OutgoingMessage, OutgoingMedia, InstanceStatus } from '@whatsbot/core'
import QRCode from 'qrcode'

interface EvoGoInstance {
  id: string
  name: string
  token: string
  connected: boolean
  qrcode: string
}

export class EvolutionAPIAdapter implements MessagingPort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {},
    instanceToken?: string,
  ): Promise<T> {
    const apikey = instanceToken ?? this.apiKey
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey,
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> ?? {}) },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Evolution Go error ${res.status}: ${body}`)
    }

    return res.json() as Promise<T>
  }

  private async _resolveInstanceId(instanceName: string): Promise<string> {
    const data = await this.request<{ data: EvoGoInstance[] }>('/instance/all')
    const instance = data.data.find((i) => i.name === instanceName)
    if (!instance) throw new Error(`Instance not found: ${instanceName}`)
    return instance.id
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const number = msg.phoneNumber.includes('@')
      ? msg.phoneNumber.split('@')[0]
      : msg.phoneNumber

    await this.request(
      '/send/text',
      { method: 'POST', body: JSON.stringify({ number, text: msg.message }) },
      msg.instanceName,
    )
  }

  async sendMedia(msg: OutgoingMedia): Promise<void> {
    const number = msg.phoneNumber.includes('@')
      ? msg.phoneNumber.split('@')[0]
      : msg.phoneNumber

    await this.request(
      '/send/media',
      {
        method: 'POST',
        body: JSON.stringify({
          number,
          type: msg.mediaType ?? 'image',
          url: msg.mediaUrl,
          ...(msg.caption ? { caption: msg.caption } : {}),
        }),
      },
      msg.instanceName,
    )
  }

  async getInstanceStatus(instanceName: string): Promise<InstanceStatus> {
    const data = await this.request<{ data: EvoGoInstance[] }>('/instance/all')
    const instance = data.data.find((i) => i.name === instanceName)
    if (!instance) return { instanceName, state: 'close' }
    const state = instance.connected ? 'open' : 'close'
    return { instanceName, state }
  }

  async createInstance(
    instanceName: string,
    webhookUrl?: string,
    webhookSecret?: string,
  ): Promise<{ qrCode: string; instanceId: string }> {
    const created = await this.request<{ data: EvoGoInstance }>(
      '/instance/create',
      {
        method: 'POST',
        body: JSON.stringify({ name: instanceName, token: instanceName }),
      },
    )

    const instanceId = created.data.id

    await this.request(
      '/instance/connect',
      {
        method: 'POST',
        body: JSON.stringify({
          immediate: true,
          webhookUrl: webhookUrl ?? '',
          subscribe: ['MESSAGE', 'CONNECTION', 'QRCODE'],
        }),
      },
      instanceName,
    )

    const qrCode = await this._fetchQRCode(instanceName)
    return { qrCode, instanceId }
  }

  async connectInstance(instanceName: string, webhookUrl?: string): Promise<{ qrCode: string }> {
    await this.request(
      '/instance/connect',
      {
        method: 'POST',
        body: JSON.stringify({
          immediate: true,
          webhookUrl: webhookUrl ?? '',
          subscribe: ['MESSAGE', 'CONNECTION', 'QRCODE'],
        }),
      },
      instanceName,
    )

    await new Promise((r) => setTimeout(r, 2000))
    const qrCode = await this._fetchQRCode(instanceName)
    return { qrCode }
  }

  async deleteInstance(instanceName: string): Promise<void> {
    const instanceId = await this._resolveInstanceId(instanceName)
    await this.request(`/instance/delete/${instanceId}`, { method: 'DELETE' })
  }

  async setWebhook(instanceName: string, webhookUrl: string, secret: string): Promise<void> {
    console.warn(`[EvolutionGo] setWebhook called for ${instanceName} — set at connect time`)
  }

  private async _fetchQRCode(instanceName: string, retries = 6, delayMs = 2000): Promise<string> {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await this.request<{ data?: { Qrcode?: string; Code?: string } }>(
          '/instance/qr',
          {},
          instanceName,
        )
        const raw = data.data?.Qrcode ?? data.data?.Code ?? ''
        if (raw) {
          if (raw.startsWith('data:image')) return raw.replace('data:image/png;base64,', '')
          if (raw.length > 100) return raw
          const png = await QRCode.toDataURL(raw)
          return png.replace('data:image/png;base64,', '')
        }
      } catch {
        // QR not ready yet
      }
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
    return ''
  }
}
