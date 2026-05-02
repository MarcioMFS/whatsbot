import type { MessagingPort, OutgoingMessage, InstanceStatus } from '@whatsbot/core'
import QRCode from 'qrcode'

export class EvolutionAPIAdapter implements MessagingPort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly proxyHost?: string,
    private readonly proxyPort?: string,
  ) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        ...options.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Evolution API error ${res.status}: ${body}`)
    }

    return res.json() as Promise<T>
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    await this.request(`/message/sendText/${msg.instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ number: msg.phoneNumber, text: msg.message }),
    })
  }

  async getInstanceStatus(instanceName: string): Promise<InstanceStatus> {
    const data = await this.request<{ instance: { state: string } }>(
      `/instance/connectionState/${instanceName}`
    )
    return { instanceName, state: data.instance.state as InstanceStatus['state'] }
  }

  // Evolution API v2 requires webhook to be included at instance creation time
  async createInstance(instanceName: string, webhookUrl?: string, webhookSecret?: string): Promise<{ qrCode: string }> {
    const payload: Record<string, unknown> = {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }

    if (webhookUrl) {
      payload.webhook = {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT'],
        headers: webhookSecret ? { 'x-webhook-secret': webhookSecret } : {},
      }
    }

    if (this.proxyHost) {
      payload.proxy = {
        host: this.proxyHost,
        port: this.proxyPort ?? '9050',
        protocol: 'socks5',
      }
    }

    const data = await this.request<{ qrcode?: { base64: string }; instance?: { qrcode?: { base64: string } } }>(
      '/instance/create',
      { method: 'POST', body: JSON.stringify(payload) }
    )

    // Response shape varies across Evolution API versions
    const base64 = data.qrcode?.base64 ?? data.instance?.qrcode?.base64 ?? ''
    return { qrCode: base64 }
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.request(`/instance/delete/${instanceName}`, { method: 'DELETE' })
  }

  async connectInstance(instanceName: string): Promise<{ qrCode: string }> {
    const data = await this.request<{ base64?: string; code?: string; count?: number }>(
      `/instance/connect/${instanceName}`
    )
    console.log('[connectInstance]', instanceName, 'base64:', !!data.base64, 'code:', !!data.code, 'count:', data.count)
    if (data.base64) return { qrCode: data.base64 }
    if (data.code) {
      const png = await QRCode.toDataURL(data.code)
      return { qrCode: png.replace('data:image/png;base64,', '') }
    }
    return { qrCode: '' }
  }

  // Kept for updating webhook on existing instances
  async setWebhook(instanceName: string, webhookUrl: string, secret: string): Promise<void> {
    await this.request(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT'],
        headers: { 'x-webhook-secret': secret },
      }),
    })
  }
}
