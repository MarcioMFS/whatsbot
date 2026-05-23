import type { FastifyInstance } from 'fastify'
import type { BotRepository, LeadRepository } from '@whatsbot/core'

interface LeadCtx {
  botRepo: BotRepository
  leadRepo: LeadRepository
}

export async function leadRoutes(app: FastifyInstance, ctx: LeadCtx) {
  app.addHook('preHandler', async (req) => { await req.jwtVerify() })

  // list leads for a bot
  app.get<{ Params: { botId: string }; Querystring: { limit?: string; offset?: string; tag?: string } }>(
    '/bot/:botId',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const limit = Math.min(Number(req.query.limit ?? 50), 200)
      const offset = Number(req.query.offset ?? 0)

      const leads = req.query.tag
        ? await ctx.leadRepo.findByTag(bot.id, req.query.tag)
        : await ctx.leadRepo.findByBotId(bot.id, limit, offset)

      const total = await ctx.leadRepo.countByBotId(bot.id)
      return { leads: leads.map(l => l.toJSON()), total }
    }
  )

  // add/remove tags manually
  app.patch<{ Params: { botId: string; phone: string }; Body: { add?: string[]; remove?: string[] } }>(
    '/bot/:botId/phone/:phone/tags',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const lead = await ctx.leadRepo.findByPhone(bot.id, req.params.phone)
      if (!lead) return reply.code(404).send({ error: 'Lead not found' })

      for (const tag of (req.body.add ?? [])) lead.addTag(tag)
      for (const tag of (req.body.remove ?? [])) lead.removeTag(tag)
      await ctx.leadRepo.save(lead)
      return lead.toJSON()
    }
  )
}
