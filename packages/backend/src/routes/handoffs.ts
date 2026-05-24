import type { FastifyInstance } from 'fastify'
import type { HandoffRepository } from '@whatsbot/core'

interface HandoffCtx {
  handoffRepo: HandoffRepository
}

export async function handoffRoutes(app: FastifyInstance, ctx: HandoffCtx) {
  app.addHook('preHandler', async (req) => { await req.jwtVerify() })

  // GET /api/handoffs/bot/:botId?status=open&limit=50&offset=0
  app.get<{ Params: { botId: string }; Querystring: { status?: string; limit?: string; offset?: string } }>(
    '/bot/:botId',
    async (req, reply) => {
      const { botId } = req.params
      const status = req.query.status as 'open' | 'in_progress' | 'resolved' | 'ignored' | undefined
      const limit = Math.min(Number(req.query.limit ?? 50), 200)
      const offset = Number(req.query.offset ?? 0)

      const [handoffs, total] = await Promise.all([
        ctx.handoffRepo.findByBotId(botId, status, limit, offset),
        ctx.handoffRepo.countByBotId(botId, status),
      ])

      return { handoffs: handoffs.map(h => h.toJSON()), total, limit, offset }
    }
  )

  // GET /api/handoffs/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    async (req, reply) => {
      const handoff = await ctx.handoffRepo.findById(req.params.id)
      if (!handoff) return reply.code(404).send({ error: 'Not found' })
      return handoff.toJSON()
    }
  )

  // PATCH /api/handoffs/:id/status
  app.patch<{ Params: { id: string }; Body: { status: string; resolvedBy?: string } }>(
    '/:id/status',
    async (req, reply) => {
      const handoff = await ctx.handoffRepo.findById(req.params.id)
      if (!handoff) return reply.code(404).send({ error: 'Not found' })

      const { status, resolvedBy } = req.body
      if (status === 'resolved') handoff.resolve(resolvedBy)
      else if (status === 'in_progress') handoff.markInProgress()
      else if (status === 'ignored') handoff.ignore()
      else return reply.code(400).send({ error: 'Invalid status' })

      await ctx.handoffRepo.save(handoff)
      return handoff.toJSON()
    }
  )
}
