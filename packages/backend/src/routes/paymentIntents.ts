import type { FastifyPluginCallback } from 'fastify'
import type { PaymentIntentRepository } from '@whatsbot/core'

interface Ctx {
  paymentIntentRepo: PaymentIntentRepository
}

export const paymentIntentRoutes: FastifyPluginCallback<Ctx> = (fastify, ctx, done) => {
  fastify.get('/bot/:botId', async (req, reply) => {
    const { botId } = req.params as { botId: string }
    const { limit, status } = req.query as { limit?: string; status?: string }
    const intents = await ctx.paymentIntentRepo.findByBot(botId, limit ? parseInt(limit) : 100)
    const filtered = status ? intents.filter(i => i.status === status) : intents
    return reply.send(filtered.map(i => i.toJSON()))
  })

  fastify.patch('/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    const intent = await ctx.paymentIntentRepo.findById(id)
    if (!intent) return reply.code(404).send({ error: 'Not found' })
    if (intent.status !== 'pending') return reply.code(400).send({ error: `Cannot cancel — status is ${intent.status}` })
    intent.cancel()
    await ctx.paymentIntentRepo.save(intent)
    return reply.send(intent.toJSON())
  })

  done()
}
