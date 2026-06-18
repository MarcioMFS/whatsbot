import type { FastifyPluginCallback } from 'fastify'
import type { PaymentIntentRepository, BotRepository } from '@whatsbot/core'

interface Ctx {
  paymentIntentRepo: PaymentIntentRepository
  botRepo: BotRepository
}

export const paymentIntentRoutes: FastifyPluginCallback<Ctx> = (fastify, ctx, done) => {
  // #sec: antes sem autenticação NEM ownership — anônimo lia a chave PIX e CANCELAVA cobranças de qualquer bot.
  fastify.addHook('preHandler', async (req) => { await req.jwtVerify() })

  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }

  fastify.get('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const { limit, status } = req.query as { limit?: string; status?: string }
    const intents = await ctx.paymentIntentRepo.findByBot(botId, limit ? parseInt(limit) : 100)
    const filtered = status ? intents.filter(i => i.status === status) : intents
    return reply.send(filtered.map(i => i.toJSON()))
  })

  fastify.patch('/:id/cancel', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const intent = await ctx.paymentIntentRepo.findById(id)
    if (!intent || !await ownsBot(intent.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    if (intent.status !== 'pending') return reply.code(400).send({ error: `Cannot cancel — status is ${intent.status}` })
    intent.cancel()
    await ctx.paymentIntentRepo.save(intent)
    return reply.send(intent.toJSON())
  })

  done()
}
