import type { FastifyInstance } from 'fastify'
import { Handoff } from '@whatsbot/core'
import type { HandoffRepository, ConversationRepository, MessagingPort, BotRepository } from '@whatsbot/core'

interface HandoffCtx {
  handoffRepo: HandoffRepository
  convRepo?: ConversationRepository
  botRepo?: BotRepository
  messaging?: MessagingPort
}

const HANDOFF_RESOLVED_MESSAGE = 'Olá! Passando aqui só pra avisar que o nosso time já verificou sua situação e está tudo certo por aqui 😊 Qualquer coisa é só chamar!'

export async function handoffRoutes(app: FastifyInstance, ctx: HandoffCtx) {
  app.addHook('preHandler', async (req) => { await req.jwtVerify() })

  // #sec: ownership — nenhuma rota checava dono (qualquer user lia/resolvia handoff de qualquer bot por UUID).
  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    if (!ctx.botRepo) return false // fail-closed: sem botRepo não há como verificar
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }
  const ownedHandoff = async (id: string, userId: string): Promise<Handoff | null> => {
    const handoff = await ctx.handoffRepo.findById(id)
    if (!handoff) return null
    return (await ownsBot(handoff.botId, userId)) ? handoff : null
  }

  // POST /api/handoffs — manual handoff creation
  app.post<{ Body: { botId: string; phoneNumber: string; reason: string; lastMessage?: string; context?: Record<string, unknown>; leadTemperature?: string; leadTags?: string[] } }>(
    '/',
    async (req, reply) => {
      const user = req.user as { id: string }
      const { botId, phoneNumber, reason, lastMessage, context, leadTemperature, leadTags } = req.body
      if (!botId || !phoneNumber || !reason) {
        return reply.code(400).send({ error: 'botId, phoneNumber and reason are required' })
      }
      if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
      const handoff = Handoff.create({
        botId,
        conversationId: 'manual',
        phoneNumber,
        reason: reason as Parameters<typeof Handoff.create>[0]['reason'],
        lastMessage: lastMessage ?? '',
        contextSummary: context ? JSON.stringify(context) : null,
        leadTemperature: leadTemperature ?? 'cold',
        leadTags: leadTags ?? [],
      })
      await ctx.handoffRepo.save(handoff)
      return reply.code(201).send(handoff.toJSON())
    }
  )

  // GET /api/handoffs/bot/:botId?status=open&limit=50&offset=0
  app.get<{ Params: { botId: string }; Querystring: { status?: string; limit?: string; offset?: string } }>(
    '/bot/:botId',
    async (req, reply) => {
      const user = req.user as { id: string }
      const { botId } = req.params
      if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
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
      const user = req.user as { id: string }
      const handoff = await ownedHandoff(req.params.id, user.id)
      if (!handoff) return reply.code(404).send({ error: 'Not found' })
      return handoff.toJSON()
    }
  )

  // PATCH /api/handoffs/:id/status
  app.patch<{ Params: { id: string }; Body: { status: string; resolvedBy?: string; sendClosingMessage?: boolean } }>(
    '/:id/status',
    async (req, reply) => {
      const user = req.user as { id: string }
      const handoff = await ownedHandoff(req.params.id, user.id)
      if (!handoff) return reply.code(404).send({ error: 'Not found' })

      const { status, resolvedBy, sendClosingMessage = true } = req.body
      if (status === 'resolved') {
        handoff.resolve(resolvedBy)

        // End the conversation so the bot doesn't restart on the next message
        if (ctx.convRepo && handoff.conversationId !== 'manual') {
          const conv = await ctx.convRepo.findById(handoff.conversationId)
          if (conv && conv.status === 'handoff') {
            conv.end()
            await ctx.convRepo.save(conv)
            console.log(`[handoffs] conversation ${handoff.conversationId} ended after handoff resolved by ${resolvedBy ?? 'dashboard'}`)
          }
        }

        // Send closing message to customer
        if (sendClosingMessage && ctx.messaging && ctx.botRepo) {
          const bot = await ctx.botRepo.findById(handoff.botId)
          if (bot) {
            try {
              await ctx.messaging.sendMessage({
                instanceName: bot.evolutionConfig.instanceName,
                instanceId: bot.evolutionConfig.instanceId,
                phoneNumber: handoff.phoneNumber,
                message: HANDOFF_RESOLVED_MESSAGE,
              })
            } catch (err) {
              console.error('[handoffs] failed to send closing message:', err instanceof Error ? err.message : err)
            }
          }
        }
      } else if (status === 'in_progress') {
        handoff.markInProgress()
      } else if (status === 'ignored') {
        handoff.ignore()

        // End conversation on ignore too (bot won't help further)
        if (ctx.convRepo && handoff.conversationId !== 'manual') {
          const conv = await ctx.convRepo.findById(handoff.conversationId)
          if (conv && conv.status === 'handoff') {
            conv.end()
            await ctx.convRepo.save(conv)
          }
        }
      } else {
        return reply.code(400).send({ error: 'Invalid status' })
      }

      await ctx.handoffRepo.save(handoff)
      return handoff.toJSON()
    }
  )
}
