import { createHmac } from 'crypto'
import type { Bot, ConversationRepository, LeadRepository, MessagingPort } from '@whatsbot/core'

// Onda 3 — canal ao vivo (runtime='external').
// Quando uma msg chega num bot com runtime='external', o motor (flow/agent) NÃO roda.
// Em vez disso, a msg é encaminhada (POST assinado) pro handler externo (ex.: Vox),
// que devolve a resposta — e o WhatsBot a entrega de volta pelo mesmo número.
// WhatsBot vira PIPE + CONTEXTO: dono da memória de conversa é o handler externo.
// Modelo síncrono (request/reply): simples e robusto p/ baixo volume (segundo cérebro pessoal).
// Ver Brain/Projetos/WhatsBot/spec_whatsbot_mcp.md.

export interface ExternalInboundDeps {
  messaging: MessagingPort
  conversationRepo: ConversationRepository
  leadRepo: LeadRepository
}

export interface ExternalDispatchOptions {
  imageBase64?: string
  hasImage?: boolean
}

interface ExternalReply {
  reply?: string
  replies?: string[]
}

export class ExternalInboundDispatcher {
  constructor(
    private readonly deps: ExternalInboundDeps,
    // timeout < lock TTL do worker (45s) p/ não soltar o lock enquanto ainda processa.
    private readonly timeoutMs = 25_000,
  ) {}

  /**
   * Encaminha a msg ao handler externo e entrega a resposta de volta.
   * Erros transitórios (rede/timeout/5xx) são re-lançados p/ o BullMQ re-tentar (durabilidade).
   * 4xx = handler rejeitou (assinatura/usuário) → loga e encerra (sem re-tentar).
   */
  async dispatch(bot: Bot, phone: string, message: string, opts: ExternalDispatchOptions = {}): Promise<void> {
    const url = bot.globalConfig?.externalInboundUrl
    const secret = bot.globalConfig?.externalInboundSecret
    if (!url) {
      console.warn(`[external] bot ${bot.id} runtime=external sem externalInboundUrl — msg ignorada`)
      return
    }

    // Contexto oportunista: p/ número dedicado/novo vem null (o handler tem memória própria),
    // mas mantém genérico — outro handler num bot com histórico recebe lead+conversa.
    const [lead, conv] = await Promise.all([
      this.deps.leadRepo.findByPhone(bot.id, phone).catch(() => null),
      this.deps.conversationRepo.findActiveByPhone(bot.id, phone).catch(() => null),
    ])

    const payload = {
      botId: bot.id,
      instance: bot.evolutionConfig.instanceName,
      phone,
      message,
      hasImage: opts.hasImage ?? false,
      imageBase64: opts.imageBase64,
      context: {
        lead: lead
          ? { name: lead.name, tags: lead.tags, temperature: lead.leadTemperature, lastState: lead.lastState, summary: lead.contextSummary }
          : null,
        conversation: conv
          ? { phase: conv.phase, status: conv.status, recentHistory: conv.history.slice(-10).map((m) => ({ role: m.role, content: m.content })) }
          : null,
      },
    }

    const body = JSON.stringify(payload)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    // Assinatura HMAC-SHA256 do corpo cru → o handler prova que veio do WhatsBot.
    if (secret) {
      headers['x-whatsbot-signature'] = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal })
    } catch (e) {
      // timeout/rede = transitório → re-lança p/ BullMQ re-tentar.
      throw Object.assign(new Error(`EXTERNAL_UNREACHABLE:${e instanceof Error ? e.message : 'erro'}`), { name: 'ExternalTransient' })
    } finally {
      clearTimeout(timer)
    }

    if (res.status >= 500) {
      throw Object.assign(new Error(`EXTERNAL_5XX:${res.status}`), { name: 'ExternalTransient' })
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.warn(`[external] handler respondeu ${res.status} bot=${bot.id} phone=${phone} body=${txt.slice(0, 200)}`)
      return
    }

    const data = (await res.json().catch(() => null)) as ExternalReply | null
    const replies = data?.replies?.length ? data.replies : data?.reply ? [data.reply] : []
    for (const text of replies) {
      if (text && text.trim()) {
        await this.deps.messaging.sendMessage({ instanceName: bot.evolutionConfig.instanceName, phoneNumber: phone, message: text })
      }
    }
  }
}
