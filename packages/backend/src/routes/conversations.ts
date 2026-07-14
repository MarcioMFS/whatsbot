import type { FastifyInstance } from 'fastify'
import type { ConversationRepository, BotRepository, AgentTraceRepository, MessagingPort } from '@whatsbot/core'
import { buildConversationStateView } from '../services/ConversationStateView.js'

interface ConvCtx {
  conversationRepo: ConversationRepository
  botRepo: BotRepository
  agentTrace: AgentTraceRepository
  messaging: MessagingPort
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

  // Conversas AO VIVO (Redis) — alimenta o painel de conversas em tempo real (polling).
  app.get<{ Params: { botId: string } }>('/bot/:botId/live', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const conversations = await ctx.conversationRepo.findActiveByBotId?.(bot.id) ?? []
    return conversations.map(c => c.toJSON())
  })

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

  // ── Controle manual (painel Conversas ao vivo) ────────────────────────────

  // Envia mensagem manual pro lead pelo número do bot. Se houver conversa ativa,
  // registra no histórico (aparece no chat); sem conversa, só envia (recuperação de lead).
  app.post<{ Params: { botId: string; phone: string }; Body: { message?: string } }>(
    '/bot/:botId/phone/:phone/send',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const message = (req.body?.message ?? '').trim()
      if (!message) return reply.code(400).send({ error: 'message obrigatória' })

      await ctx.messaging.sendMessage({
        instanceName: bot.evolutionConfig.instanceName,
        instanceId: bot.evolutionConfig.instanceId,
        phoneNumber: req.params.phone,
        message,
      })

      const conversation = await ctx.conversationRepo.findActiveByPhone(bot.id, req.params.phone)
      if (conversation) {
        conversation.addAssistantMessage(message)
        await ctx.conversationRepo.save(conversation)
      }
      return { ok: true, inConversation: !!conversation }
    }
  )

  // Pausa o funil pra esse lead (status handoff — o bot ignora mensagens até retomar).
  app.post<{ Params: { botId: string; phone: string } }>(
    '/bot/:botId/phone/:phone/pause',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const conversation = await ctx.conversationRepo.findActiveByPhone(bot.id, req.params.phone)
      if (!conversation) return reply.code(404).send({ error: 'Sem conversa ativa' })
      conversation.handoff()
      await ctx.conversationRepo.save(conversation)
      return { ok: true, status: 'handoff' }
    }
  )

  // Devolve pro bot no ponto em que estava (status waiting no nó atual —
  // a próxima mensagem do lead continua o fluxo dali).
  app.post<{ Params: { botId: string; phone: string } }>(
    '/bot/:botId/phone/:phone/resume',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const conversation = await ctx.conversationRepo.findActiveByPhone(bot.id, req.params.phone)
      if (!conversation) return reply.code(404).send({ error: 'Sem conversa ativa' })
      conversation.resume()
      await ctx.conversationRepo.save(conversation)
      return { ok: true, status: 'waiting', node: conversation.currentNodeId }
    }
  )

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
