import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'crypto'
import { Queue } from 'bullmq'
import type Redis from 'ioredis'
import type { BotRepository } from '@whatsbot/core'

interface WebhookCtx {
  botRepo: BotRepository
  redis: Redis
}

export async function webhookRoutes(app: FastifyInstance, ctx: WebhookCtx) {
  const messageQueue = new Queue('messages', {
    connection: { url: process.env.REDIS_URL!, maxRetriesPerRequest: null },
  })

  app.post<{ Params: { botId: string } }>(
    '/evolution/:botId',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot) return reply.code(404).send({ error: 'Bot not found' })

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
      const msgGo = raw.Message as Record<string, unknown> | undefined
      const keyApi = raw.key as Record<string, unknown> | undefined
      const msgApi = raw.message as Record<string, unknown> | undefined

      const fromMe = (info?.IsFromMe ?? keyApi?.fromMe ?? false) as boolean
      if (fromMe) return reply.code(200).send()

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

      const extText = (msgApi?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined

      const imgMsg = (msgGo?.imageMessage ?? msgApi?.imageMessage) as Record<string, unknown> | undefined
      const hasImage = !!(imgMsg ?? msgGo?.documentMessage ?? msgApi?.documentMessage)

      // Objeto Message completo para /message/downloadimage
      const imageCaption = (imgMsg?.caption as string | undefined) ?? ''
      const imageMeta = imgMsg ? { imgMsg } : undefined

      const message =
        (msgGo?.conversation as string | undefined) ??
        (msgGo?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined ??
        (msgApi?.conversation as string | undefined) ??
        extText ??
        (raw.text as string | undefined) ??
        (raw.body as string | undefined) ??
        (hasImage ? (imageCaption || '[image]') : '')

      if (!phoneNumber || !message.trim()) return reply.code(200).send()

      await messageQueue.add('process', {
        botId: bot.id,
        phoneNumber,
        message,
        msgId: msgId || undefined,
        hasImage,
        imageMeta: imageMeta || undefined,
      })
      return reply.code(200).send({ ok: true })
    }
  )
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
