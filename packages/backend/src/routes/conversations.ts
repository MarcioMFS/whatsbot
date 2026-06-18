import type { FastifyInstance } from 'fastify'
import type { ConversationRepository, BotRepository, AgentTraceRepository } from '@whatsbot/core'
import { buildConversationStateView } from '../services/ConversationStateView.js'

interface ConvCtx {
  conversationRepo: ConversationRepository
  botRepo: BotRepository
  agentTrace: AgentTraceRepository
}

export async function conversationRoutes(app: FastifyInstance, ctx: ConvCtx) {
  app.addHook('preHandler', async (req) => {
    await req.jwtVerify()
  })

  app.get<{ Params: { botId: string }; Querystring: { limit?: string } }>(
    '/bot/:botId',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const limit = Math.min(Number(req.query.limit ?? 50), 200)
      const conversations = await ctx.conversationRepo.findByBotId(bot.id, limit)
      return conversations.map(c => c.toJSON())
    }
  )

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const conversation = await ctx.conversationRepo.findById(req.params.id)
    if (!conversation) return reply.code(404).send({ error: 'Not found' })
    // #sec: faltava checar dono — vazava phoneNumber/history/variables cross-tenant
    const bot = await ctx.botRepo.findById(conversation.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })
    return conversation.toJSON()
  })

  // Trilha do agente: quem foi chamado, com quais args, o que voltou (auditoria durável).
  app.get<{ Params: { id: string } }>('/:id/agent-trace', async (req, reply) => {
    const user = req.user as { id: string }
    const conversation = await ctx.conversationRepo.findById(req.params.id)
    if (!conversation) return reply.code(404).send({ error: 'Not found' })
    const bot = await ctx.botRepo.findById(conversation.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })
    return { trace: await ctx.agentTrace.listByConversation(req.params.id) }
  })

  // Debug state view — current_phase, locked_state, cart, intent, etc.
  app.get<{ Params: { botId: string; phone: string } }>(
    '/bot/:botId/phone/:phone/state',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const conversation = await ctx.conversationRepo.findActiveByPhone(bot.id, req.params.phone)
      if (!conversation) return reply.code(404).send({ error: 'No active conversation for this phone' })

      return buildConversationStateView(conversation)
    }
  )
}
