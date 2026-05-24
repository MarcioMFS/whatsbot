import type { FastifyPluginCallback } from 'fastify'
import type { OrderRepository } from '@whatsbot/core'

interface OrderCtx {
  orderRepo: OrderRepository
}

export const orderRoutes: FastifyPluginCallback<OrderCtx> = (fastify, ctx, done) => {
  fastify.get('/bot/:botId', async (req, reply) => {
    const { botId } = req.params as { botId: string }
    const { limit } = req.query as { limit?: string }
    const orders = await ctx.orderRepo.findByBotId(botId, limit ? parseInt(limit) : 50)
    return reply.send(orders.map(o => o.toJSON()))
  })

  fastify.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const order = await ctx.orderRepo.findById(id)
    if (!order) return reply.code(404).send({ error: 'Order not found' })
    return reply.send(order.toJSON())
  })

  done()
}
