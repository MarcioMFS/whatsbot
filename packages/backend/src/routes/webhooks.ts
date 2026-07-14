import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual } from 'crypto'
import { Queue } from 'bullmq'
import type Redis from 'ioredis'
import type { BotRepository, Bot } from '@whatsbot/core'
import type { CloudAPIAdapter } from '../adapters/CloudAPIAdapter.js'

interface WebhookCtx {
  botRepo: BotRepository
  redis: Redis
  cloudAdapter?: CloudAPIAdapter | null
}

export async function webhookRoutes(app: FastifyInstance, ctx: WebhookCtx) {
  const messageQueue = new Queue('messages', {
    connection: { url: process.env.REDIS_URL!, maxRetriesPerRequest: null },
  })

  // #sec C2: handler compartilhado. O canal de AUTH do webhook é o TOKEN no path (rota nova abaixo);
  // a gateway evolution-go não envia headers customizados, então assinatura-por-header não funciona.
  const processEvolutionWebhook = async (bot: Bot, req: FastifyRequest, reply: FastifyReply) => {
      // Header legado opcional — honrado se enviado (não é o canal de auth real; ver token no path).
      const signature = req.headers['x-webhook-secret'] as string | undefined
      if (signature && !verifySecret(signature, bot.webhookSecret)) {
        return reply.code(401).send({ error: 'Invalid signature' })
      }

      const payload = req.body as Record<string, unknown>
      const event = ((payload.event as string) ?? '').toUpperCase()

      if (event !== 'MESSAGE' && event !== 'MESSAGES_UPSERT') return reply.code(200).send()

      const raw = (payload.data ?? payload) as Record<string, unknown>

      // Evolution Go format: { Info: { Chat, IsFromMe, IsGroup, ID }, Message: { ... } }
      // Evolution API format: { key: { remoteJid, fromMe, id }, message: { ... } }
      const info = raw.Info as Record<string, unknown> | undefined
      const keyApi = raw.key as Record<string, unknown> | undefined
      // Peel WhatsApp wrapper layers (viewOnce, ephemeral, documentWithCaption, edited, future ones)
      // so the real imageMessage/audioMessage/text is reached regardless of how it was wrapped.
      const msgGo = unwrapMessage(raw.Message as Record<string, unknown> | undefined)
      const msgApi = unwrapMessage(raw.message as Record<string, unknown> | undefined)

      const fromMe = (info?.IsFromMe ?? keyApi?.fromMe ?? false) as boolean

      const isGroup = (info?.IsGroup ?? false) as boolean
      if (isGroup) return reply.code(200).send()

      // Deduplicação — Evolution Go envia 2-3 webhooks por mensagem
      const msgId = (info?.ID ?? keyApi?.id ?? '') as string
      if (msgId) {
        const dedupKey = `webhook:dedup:${bot.id}:${msgId}`
        const already = await ctx.redis.set(dedupKey, '1', 'EX', 30, 'NX')
        if (!already) return reply.code(200).send({ ok: true, dup: true })
      }

      const chat = (info?.Chat ?? keyApi?.remoteJid ?? '') as string
      const jid = chat.endsWith('@lid') && keyApi?.remoteJidAlt
        ? (keyApi.remoteJidAlt as string)
        : chat
      const phoneNumber = jid.split('@')[0]

      // Owner test mode: allow owner's fromMe messages through when enabled
      const ownerTestMode = bot.globalConfig?.ownerTestMode ?? false
      const ownerPhone = bot.globalConfig?.ownerPhone?.replace(/\D/g, '')
      const isOwner = !!ownerPhone && phoneNumber === ownerPhone
      if (fromMe && !(ownerTestMode && isOwner)) return reply.code(200).send()

      const extText = (msgApi?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined

      const imgMsg = (msgGo?.imageMessage ?? msgApi?.imageMessage) as Record<string, unknown> | undefined
      // Comprovante em PDF (ou imagem enviada como documento): banco gera PDF, não print.
      // Só aceita PDF/imagem; o decrypt do worker lê via mimetype (já trata 'document').
      const docMsg = (msgGo?.documentMessage ?? msgApi?.documentMessage) as Record<string, unknown> | undefined
      const docMime = (docMsg?.mimetype as string | undefined) ?? ''
      const docSupported = docMime === 'application/pdf' || docMime.startsWith('image/')
      const mediaMsg = imgMsg ?? (docSupported ? docMsg : undefined)
      const hasImage = !!mediaMsg

      // Objeto Message completo para download/decrypt no worker
      const imageCaption = ((imgMsg?.caption ?? docMsg?.caption) as string | undefined) ?? ''
      const imageMeta = mediaMsg ? { imgMsg: mediaMsg } : undefined

      // Voice notes (PTT) — decrypt + transcribe happens in the worker
      const audioMsg = (msgGo?.audioMessage ?? msgApi?.audioMessage) as Record<string, unknown> | undefined
      const hasAudio = !!audioMsg
      const audioMeta = audioMsg ? { audioMsg } : undefined

      const message =
        (msgGo?.conversation as string | undefined) ??
        (msgGo?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined ??
        (msgApi?.conversation as string | undefined) ??
        extText ??
        (raw.text as string | undefined) ??
        (raw.body as string | undefined) ??
        (hasImage ? (imageCaption || '[image]') : '')

      // Audio carries no text here — the transcript is produced in the worker.
      if (!phoneNumber || (!message.trim() && !hasAudio)) {
        // Safety net: never drop content silently. If something arrived but we extracted
        // no text/image/audio, log the message keys so unhandled types surface instead of vanishing.
        if (phoneNumber && !hasImage && !hasAudio) {
          const keys = [...Object.keys(msgGo ?? {}), ...Object.keys(msgApi ?? {})]
          if (keys.length) {
            console.warn(`[webhook] no_content_dropped phone=${phoneNumber} msgId=${msgId || 'n/a'} keys=${JSON.stringify(keys)}`)
          }
        }
        return reply.code(200).send()
      }

      await messageQueue.add('process', {
        botId: bot.id,
        phoneNumber,
        message,
        msgId: msgId || undefined,
        hasImage,
        imageMeta: imageMeta || undefined,
        hasAudio,
        audioMeta: audioMeta || undefined,
      }, {
        // Retry deve cobrir o lock TTL (45s no messageWorker) — senão msg concorrente
        // do mesmo telefone esgota antes do lock liberar e é DESCARTADA (mensagem engolida).
        // Exponencial: rápido no caso comum (lock libera em segundos), cobre ~94s no pior caso.
        attempts: 8,
        backoff: { type: 'exponential', delay: 1500 }, // 1.5,3,6,12,24,48,96s
      })
      return reply.code(200).send({ ok: true })
  }

  const rl = { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }

  // #sec C2 passo 3: rota legada DESATIVADA — exige token no path. Todos os bots ativos foram
  // re-registrados com a URL-com-token (bot-01 conectado + validado; bot-02 desconectado já com a
  // URL-token no DB). Sem token = forja anônima → 401. Reverter = voltar a chamar processEvolutionWebhook.
  app.post<{ Params: { botId: string } }>('/evolution/:botId', rl, async (_req, reply) => {
    return reply.code(401).send({ error: 'Webhook token required in path' })
  })

  // #sec C2 passo 1 (additivo): token no path = bot.webhookSecret (timing-safe). Nenhum bot usa esta URL
  // ainda; quando os webhooks forem re-registrados com ela (passo 2) e a legada for desativada (passo 3),
  // só requisições com o token válido passam — fecha a forja anônima.
  app.post<{ Params: { botId: string; token: string } }>('/evolution/:botId/:token', rl, async (req, reply) => {
    const bot = await ctx.botRepo.findById(req.params.botId)
    if (!bot) return reply.code(404).send({ error: 'Bot not found' })
    if (!verifySecret(req.params.token, bot.webhookSecret)) {
      return reply.code(401).send({ error: 'Invalid webhook token' })
    }
    return processEvolutionWebhook(bot, req, reply)
  })

  // ── WhatsApp Cloud API oficial (Meta) ─────────────────────────────────────
  // Verificação do webhook (feita uma vez, ao configurar no painel da Meta).
  app.get('/cloudapi', async (req, reply) => {
    const q = req.query as Record<string, string>
    const verifyToken = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN
    if (verifyToken && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verifyToken) {
      return reply.code(200).send(q['hub.challenge'])
    }
    return reply.code(403).send()
  })

  // Mensagens entrantes da Meta. Bot é resolvido pelo phone_number_id
  // (evolutionConfig.instanceName === "cloudapi:<phone_number_id>").
  app.post('/cloudapi', rl, async (req, reply) => {
    const payload = req.body as {
      entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }>
    }
    // A Meta reenvia sem cessar se não receber 200 — sempre confirme.
    reply.code(200).send({ ok: true })

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value as {
          metadata?: { phone_number_id?: string }
          messages?: Array<Record<string, any>>
        } | undefined
        const pnid = value?.metadata?.phone_number_id
        if (!pnid || !value?.messages?.length) continue

        const bots = await ctx.botRepo.findAllActive()
        const bot = bots.find(b => b.evolutionConfig.instanceName === `cloudapi:${pnid}`)
        if (!bot) {
          console.warn(`[cloudapi] webhook para phone_number_id=${pnid} sem bot correspondente`)
          continue
        }

        for (const m of value.messages) {
          const msgId = m.id as string | undefined
          if (msgId) {
            const already = await ctx.redis.set(`webhook:dedup:${bot.id}:${msgId}`, '1', 'EX', 60, 'NX')
            if (!already) continue
          }

          const phoneNumber = (m.from as string | undefined) ?? ''
          if (!phoneNumber) continue

          let message = ''
          let imageBase64: string | undefined
          if (m.type === 'text') {
            message = m.text?.body ?? ''
          } else if (m.type === 'button') {
            message = m.button?.text ?? ''
          } else if (m.type === 'interactive') {
            message = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''
          } else if (m.type === 'image' || m.type === 'document') {
            const media = m[m.type] as { id?: string; caption?: string; mime_type?: string } | undefined
            const supported = m.type === 'image' ||
              media?.mime_type === 'application/pdf' || (media?.mime_type ?? '').startsWith('image/')
            if (supported && media?.id && ctx.cloudAdapter) {
              const dl = await ctx.cloudAdapter.downloadMedia(media.id)
              if (dl) imageBase64 = dl.base64
            }
            message = media?.caption || '[image]'
          } else {
            console.warn(`[cloudapi] tipo de mensagem não tratado: ${m.type}`)
            continue
          }

          if (!message.trim() && !imageBase64) continue

          await messageQueue.add('process', {
            botId: bot.id,
            phoneNumber,
            message,
            msgId,
            hasImage: !!imageBase64,
            imageBase64,
          }, {
            attempts: 8,
            backoff: { type: 'exponential', delay: 1500 },
          })
        }
      }
    }
  })
}

const MAX_UNWRAP_DEPTH = 5

/**
 * Recursively peel WhatsApp/Baileys wrapper layers until the real content message is reached.
 * Generic (not a hardcoded type list): any key whose value nests a `.message`/`.Message` object
 * is treated as a wrapper and descended into. Handles viewOnceMessage(V2), ephemeralMessage,
 * documentWithCaptionMessage, editedMessage, and any future wrapper of the same shape.
 * Content keys (imageMessage, audioMessage, conversation, extendedTextMessage) have no nested
 * `.message`, so they are returned untouched. Depth-limited to avoid pathological loops.
 */
function unwrapMessage(
  msg: Record<string, unknown> | undefined,
  depth = 0,
): Record<string, unknown> | undefined {
  if (!msg || typeof msg !== 'object' || depth >= MAX_UNWRAP_DEPTH) return msg
  for (const value of Object.values(msg)) {
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>
      const inner = (v.message ?? v.Message) as Record<string, unknown> | undefined
      if (inner && typeof inner === 'object') {
        return unwrapMessage(inner, depth + 1)
      }
    }
  }
  return msg
}

function verifySecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  try {
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
