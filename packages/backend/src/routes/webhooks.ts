import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'crypto'
import { Queue } from 'bullmq'
import type { BotRepository } from '@whatsbot/core'

interface WebhookCtx {
  botRepo: BotRepository
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
      if (!verifySecret(signature, bot.webhookSecret)) {
        return reply.code(401).send({ error: 'Invalid signature' })
      }

      const payload = req.body as Record<string, unknown>
      console.log('[webhook] event:', payload.event, '| keys:', Object.keys(payload))
      const event = (payload.event as string ?? '').toLowerCase().replace('.', '_')
      if (event !== 'messages_upsert') return reply.code(200).send()

      console.log('[webhook] data:', JSON.stringify(payload.data).substring(0, 300))
      const data = payload.data as {
        key: { remoteJid: string; fromMe: boolean }
        message?: { conversation?: string; extendedTextMessage?: { text: string } }
      }

      if (data.key.fromMe) return reply.code(200).send()

      const phoneNumber = data.key.remoteJid.replace('@s.whatsapp.net', '')
      const message =
        data.message?.conversation ??
        data.message?.extendedTextMessage?.text ??
        ''

      if (!message.trim()) return reply.code(200).send()

      await messageQueue.add('process', { botId: bot.id, phoneNumber, message })

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
