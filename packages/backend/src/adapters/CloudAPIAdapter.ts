import type { MessagingPort, OutgoingMessage, OutgoingMedia, OutgoingPresence, InstanceStatus } from '@whatsbot/core'

/**
 * WhatsApp Cloud API oficial (Meta Graph API).
 *
 * Convenção de canal: bots oficiais usam evolutionConfig.instanceName = "cloudapi:<phone_number_id>"
 * (o ChannelRouterAdapter roteia por esse prefixo — nenhum outro código muda).
 *
 * Janela de 24h: o funil é reativo (responde mensagens do cliente), então NÃO precisa de
 * templates pagos; conversas iniciadas por anúncio click-to-WhatsApp têm janela grátis de 72h.
 */
export class CloudAPIAdapter implements MessagingPort {
  constructor(
    private readonly token: string,
    private readonly apiVersion = 'v21.0',
  ) {}

  private phoneNumberId(instanceName: string): string {
    return instanceName.replace(/^cloudapi:/, '')
  }

  private async request(pnid: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${pnid}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`CloudAPI error ${res.status}: ${text}`)
    }
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const to = msg.phoneNumber.split('@')[0]
    await this.request(this.phoneNumberId(msg.instanceName), {
      to,
      type: 'text',
      text: { body: msg.message, preview_url: true },
    })
  }

  async sendMedia(msg: OutgoingMedia): Promise<void> {
    const to = msg.phoneNumber.split('@')[0]
    const type = msg.mediaType ?? 'image'
    const media: Record<string, unknown> = { link: msg.mediaUrl }
    if (msg.caption) media.caption = msg.caption
    if (type === 'document' && msg.filename) media.filename = msg.filename
    await this.request(this.phoneNumberId(msg.instanceName), { to, type, [type]: media })
  }

  // Cloud API só mostra "digitando…" atrelado à leitura de uma mensagem específica
  // (message_id), que não temos aqui — no-op; o pacing do simulateTyping continua valendo.
  async sendPresence(_msg: OutgoingPresence): Promise<void> {}

  async getInstanceStatus(instanceName: string): Promise<InstanceStatus> {
    const pnid = this.phoneNumberId(instanceName)
    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${pnid}?fields=id`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      return { instanceName, state: res.ok ? 'open' : 'close' }
    } catch {
      return { instanceName, state: 'close' }
    }
  }

  // Instâncias Cloud API são criadas no painel da Meta, não por aqui.
  async createInstance(): Promise<{ qrCode: string }> {
    throw new Error('Cloud API: número é configurado no painel da Meta (não há QR)')
  }
  async connectInstance(): Promise<{ qrCode: string }> {
    return { qrCode: '' }
  }
  async deleteInstance(): Promise<void> {}
  async setWebhook(): Promise<void> {}

  /** Baixa mídia recebida (imagem/PDF de comprovante) pelo media_id do webhook. */
  async downloadMedia(mediaId: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
      const metaRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!metaRes.ok) return null
      const meta = await metaRes.json() as { url?: string; mime_type?: string }
      if (!meta.url) return null
      const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${this.token}` } })
      if (!binRes.ok) return null
      const buf = Buffer.from(await binRes.arrayBuffer())
      return { base64: buf.toString('base64'), mimeType: meta.mime_type ?? 'image/jpeg' }
    } catch {
      return null
    }
  }
}

/**
 * Roteia mensagens de saída por canal: instanceName com prefixo "cloudapi:" → API oficial;
 * resto → evolution-go (não-oficial). Permite bots dos dois canais convivendo no mesmo backend.
 */
export class ChannelRouterAdapter implements MessagingPort {
  constructor(
    private readonly evolution: MessagingPort,
    private readonly cloud: CloudAPIAdapter | null,
  ) {}

  private pick(instanceName: string): MessagingPort {
    if (instanceName.startsWith('cloudapi:')) {
      if (!this.cloud) throw new Error('Cloud API não configurada (WHATSAPP_CLOUD_TOKEN ausente)')
      return this.cloud
    }
    return this.evolution
  }

  sendMessage(msg: OutgoingMessage) { return this.pick(msg.instanceName).sendMessage(msg) }
  sendMedia(msg: OutgoingMedia) {
    const port = this.pick(msg.instanceName)
    return port.sendMedia ? port.sendMedia(msg) : Promise.resolve()
  }
  sendPresence(msg: OutgoingPresence) {
    const port = this.pick(msg.instanceName)
    return port.sendPresence ? port.sendPresence(msg) : Promise.resolve()
  }
  getInstanceStatus(instanceName: string) { return this.pick(instanceName).getInstanceStatus(instanceName) }
  createInstance(instanceName: string, webhookUrl?: string, webhookSecret?: string) {
    return this.evolution.createInstance(instanceName, webhookUrl, webhookSecret)
  }
  connectInstance(instanceName: string, webhookUrl?: string) {
    return this.pick(instanceName).connectInstance(instanceName, webhookUrl)
  }
  deleteInstance(instanceName: string) { return this.pick(instanceName).deleteInstance(instanceName) }
  setWebhook(instanceName: string, webhookUrl: string, secret: string) {
    return this.pick(instanceName).setWebhook(instanceName, webhookUrl, secret)
  }
}
