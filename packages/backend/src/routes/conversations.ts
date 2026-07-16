import type { FastifyInstance } from 'fastify'
import { Conversation } from '@whatsbot/core'
import type { ConversationRepository, BotRepository, AgentTraceRepository, MessagingPort, FlowRepository, Flow } from '@whatsbot/core'
import type { FlowExecutionService } from '../services/FlowExecutionService.js'
import { buildConversationStateView } from '../services/ConversationStateView.js'

interface ConvCtx {
  conversationRepo: ConversationRepository
  botRepo: BotRepository
  agentTrace: AgentTraceRepository
  messaging: MessagingPort
  flowRepo: FlowRepository
  flowExecService: FlowExecutionService
}

// Entregáveis do bot = nó payment_confirmed do flow ativo (a corrente de entrega pendura nele)
function deliveryInfo(flow: Flow | null) {
  const pc = flow?.nodes.find(n => n.type === 'payment_confirmed')
  const docs = flow?.nodes.filter(n => n.type === 'image' && (n.data as { mediaType?: string }).mediaType === 'document') ?? []
  return { available: !!pc, docs: docs.length, startNodeId: pc?.id ?? null }
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

  // O bot tem entregáveis? (mostra/esconde o botão "Entregar produto" na UI)
  app.get<{ Params: { botId: string } }>('/bot/:botId/deliverables', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })
    const flow = bot.activeFlowId ? await ctx.flowRepo.findById(bot.activeFlowId) : null
    const info = deliveryInfo(flow)
    return { available: info.available, docs: info.docs }
  })

  // Entrega manual: roda o flow a partir do payment_confirmed (confirmação + entregáveis
  // + tag buyer + fim) — mesmo caminho da entrega automática pós-comprovante.
  app.post<{ Params: { botId: string; phone: string } }>(
    '/bot/:botId/phone/:phone/deliver',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const flow = bot.activeFlowId ? await ctx.flowRepo.findById(bot.activeFlowId) : null
      const info = deliveryInfo(flow)
      if (!flow || !info.startNodeId) return reply.code(400).send({ error: 'Bot sem entregáveis no flow ativo' })

      let conversation = await ctx.conversationRepo.findActiveByPhone(bot.id, req.params.phone)
      if (!conversation) {
        conversation = Conversation.create({
          botId: bot.id, flowId: flow.id, phoneNumber: req.params.phone,
          triggerNodeId: info.startNodeId,
        })
      }
      conversation.moveToNode(info.startNodeId)
      await ctx.flowExecService.resumeFromNode(bot, flow, conversation)
      return { ok: true, docs: info.docs }
    }
  )

  // Controle de posição: move a conversa pra um nó específico do funil e DISPARA o flow
  // dali (voltar ou adiantar). Sem conversa ativa (ex.: encerrada), cria uma já posicionada
  // no nó — serve pra reengajar um lead a partir de qualquer parte do roteiro.
  app.post<{ Params: { botId: string; phone: string }; Body: { nodeId?: string } }>(
    '/bot/:botId/phone/:phone/goto',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const nodeId = (req.body?.nodeId ?? '').trim()
      if (!nodeId) return reply.code(400).send({ error: 'nodeId obrigatório' })

      let conversation = await ctx.conversationRepo.findActiveByPhone(bot.id, req.params.phone)
      const flowId = conversation?.flowId ?? bot.activeFlowId
      const flow = flowId ? await ctx.flowRepo.findById(flowId) : null
      if (!flow) return reply.code(400).send({ error: 'Sem flow pra essa conversa' })
      if (!flow.getNodeById(nodeId)) return reply.code(400).send({ error: 'Nó não existe no flow dessa conversa' })

      if (!conversation) {
        conversation = Conversation.create({
          botId: bot.id, flowId: flow.id, phoneNumber: req.params.phone,
          triggerNodeId: nodeId,
        })
      }
      conversation.moveToNode(nodeId)
      await ctx.flowExecService.resumeFromNode(bot, flow, conversation)
      return { ok: true, firedNode: nodeId, node: conversation.currentNodeId, status: conversation.status }
    }
  )

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
