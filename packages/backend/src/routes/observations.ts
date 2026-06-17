import type { FastifyInstance } from 'fastify'
import type { AIObservationRepository, BotRepository } from '@whatsbot/core'

interface ObservationCtx {
  observationRepo: AIObservationRepository
  botRepo: BotRepository
}

// AI-router observability: what the AI decided, how it routed, and how it ended.
export async function observationRoutes(app: FastifyInstance, ctx: ObservationCtx) {
  app.addHook('preHandler', async (req) => { await req.jwtVerify() })

  // #sec: ownership — antes qualquer user lia/rotulava observação de qualquer bot por botId/UUID.
  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }

  // Recent AI decisions for a bot (raw observation feed)
  app.get<{ Params: { botId: string }; Querystring: { limit?: string } }>(
    '/bot/:botId',
    async (req, reply) => {
      const user = req.user as { id: string }
      if (!await ownsBot(req.params.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
      const limit = req.query.limit ? Number(req.query.limit) : 100
      const observations = await ctx.observationRepo.findByBotId(req.params.botId, limit)
      return reply.send({ observations })
    }
  )

  // Problematic decisions: rule fallbacks or low confidence
  app.get<{ Params: { botId: string }; Querystring: { days?: string } }>(
    '/bot/:botId/problematic',
    async (req, reply) => {
      const user = req.user as { id: string }
      if (!await ownsBot(req.params.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
      const days = req.query.days ? Number(req.query.days) : 7
      const observations = await ctx.observationRepo.findProblematic(req.params.botId, days)
      return reply.send({ observations })
    }
  )

  // Aggregate stats: fallback rate, outcomes, intent distribution
  app.get<{ Params: { botId: string }; Querystring: { days?: string } }>(
    '/bot/:botId/stats',
    async (req, reply) => {
      const user = req.user as { id: string }
      if (!await ownsBot(req.params.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
      const days = req.query.days ? Number(req.query.days) : 7
      const stats = await ctx.observationRepo.getStats(req.params.botId, days)
      return reply.send({ stats })
    }
  )

  // Manual outcome label (operator marks a decision good/bad)
  app.patch<{ Params: { id: string }; Body: { outcome: string; reason?: string } }>(
    '/:id/outcome',
    async (req, reply) => {
      const user = req.user as { id: string }
      if (!req.body?.outcome) return reply.code(400).send({ error: 'outcome required' })
      const obs = await ctx.observationRepo.findById(req.params.id)
      if (!obs || !await ownsBot(obs.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
      await ctx.observationRepo.updateOutcome(req.params.id, req.body.outcome, req.body.reason)
      return reply.send({ ok: true })
    }
  )
}
