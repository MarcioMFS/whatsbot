import type { FastifyPluginCallback } from 'fastify'
import type { OrderRepository, BotRepository } from '@whatsbot/core'

interface OrderCtx {
  orderRepo: OrderRepository
  botRepo: BotRepository
}

export const orderRoutes: FastifyPluginCallback<OrderCtx> = (fastify, ctx, done) => {
  // #sec: antes sem autenticação NEM ownership — anônimo lia pedidos (valores/leadId/PIX) de qualquer bot.
  fastify.addHook('preHandler', async (req) => { await req.jwtVerify() })

  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }

  fastify.get('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const { limit } = req.query as { limit?: string }
    const orders = await ctx.orderRepo.findByBotId(botId, limit ? parseInt(limit) : 50)
    return reply.send(orders.map(o => o.toJSON()))
  })

  fastify.get('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const order = await ctx.orderRepo.findById(id)
    if (!order || !await ownsBot(order.botId, user.id)) return reply.code(404).send({ error: 'Order not found' })
    return reply.send(order.toJSON())
  })

  done()
}
