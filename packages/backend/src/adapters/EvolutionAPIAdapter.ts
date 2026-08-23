import type { MessagingPort, OutgoingMessage, OutgoingMedia, OutgoingPresence, InstanceStatus } from '@whatsbot/core'
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

    // Timeout duro: um send pendurado (evolution-go "info query timed out" leva 60s+)
    // segurava a execução além do lock por telefone e a reentrega do webhook rodava a
    // MESMA mensagem em paralelo → bolhas duplicadas (visto em prod 2026-07-15).
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> ?? {}) },
      signal: (options as { signal?: AbortSignal }).signal ?? AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Evolution Go error ${res.status}: ${body}`)
    }

    return res.json() as Promise<T>
  }

  // O evolution-go "normaliza" celular BR de 13 dígitos REMOVENDO o nono dígito —
  // quebra contas novas cujo JID canônico TEM o 9 (lead real perdeu 5 respostas do
  // funil, 2026-07-17). JID explícito pula a heurística do gateway; quem já vem com
  // '@' passa intacto. O fallback (abaixo) cobre contas antigas com canônico sem 9.
  private waNumber(phoneNumber: string): string {
    if (phoneNumber.includes('@')) return phoneNumber
    const digits = phoneNumber.replace(/\D/g, '')
    return digits.startsWith('55') && digits.length === 13 ? `${digits}@s.whatsapp.net` : phoneNumber
  }

  private isNotRegistered(err: unknown): boolean {
    return err instanceof Error && err.message.includes('is not registered on WhatsApp')
  }

  private async _resolveInstanceId(instanceName: string): Promise<string> {
    const data = await this.request<{ data: EvoGoInstance[] }>('/instance/all')
    const instance = data.data.find((i) => i.name === instanceName)
    if (!instance) throw new Error(`Instance not found: ${instanceName}`)
    return instance.id
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const number = this.waNumber(msg.phoneNumber)
    try {
      await this.request(
        '/send/text',
        { method: 'POST', body: JSON.stringify({ number, text: msg.message }) },
        msg.instanceName,
      )
    } catch (err) {
      // conta antiga (canônico sem o 9): re-tenta com o número cru — o gateway aplica a heurística dele
      if (number !== msg.phoneNumber && this.isNotRegistered(err)) {
        await this.request(
          '/send/text',
          { method: 'POST', body: JSON.stringify({ number: msg.phoneNumber, text: msg.message }) },
          msg.instanceName,
        )
        return
      }
      throw err
    }
  }

  async sendMedia(msg: OutgoingMedia): Promise<void> {
    const body = (n: string) => JSON.stringify({
      number: n,
      type: msg.mediaType ?? 'image',
      url: msg.mediaUrl,
      ...(msg.caption ? { caption: msg.caption } : {}),
      ...(msg.filename ? { filename: msg.filename } : {}),
    })
    const number = this.waNumber(msg.phoneNumber)
    try {
      await this.request('/send/media', { method: 'POST', body: body(number) }, msg.instanceName)
    } catch (err) {
      if (number !== msg.phoneNumber && this.isNotRegistered(err)) {
        await this.request('/send/media', { method: 'POST', body: body(msg.phoneNumber) }, msg.instanceName)
        return
      }
      throw err
    }
  }

  async sendPresence(msg: OutgoingPresence): Promise<void> {
    const number = this.waNumber(msg.phoneNumber)

    await this.request(
      '/message/presence',
      { method: 'POST', body: JSON.stringify({ number, state: msg.state, isAudio: false }) },
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

  async instanceExists(instanceName: string): Promise<boolean> {
    const data = await this.request<{ data: EvoGoInstance[] }>('/instance/all')
    return data.data.some((i) => i.name === instanceName)
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
        const data = await this.request<{ data?: Record<string, string> }>(
          '/instance/qr',
          {},
          instanceName,
        )
        // evolution-go novo (2026-07) renomeou os campos pra minúsculo — aceitar ambos
        const d = data.data ?? {}
        const raw = d.Qrcode ?? d.qrcode ?? d.Code ?? d.code ?? ''
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
