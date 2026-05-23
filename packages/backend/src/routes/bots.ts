import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { BotRepository, FlowRepository, MessagingPort } from '@whatsbot/core'
import type { BotService } from '../services/BotService.js'

const CreateBotSchema = z.object({
  name: z.string().min(1).max(100),
  productInfo: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    persona: z.string().min(1),
    language: z.string().default('pt-BR'),
    extraContext: z.string().optional(),
  }),
  aiConfig: z.object({
    provider: z.enum(['claude', 'groq']),
    model: z.string(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().min(1).max(8192).default(1024),
    systemPromptTemplate: z.string().min(1),
  }),
  evolutionConfig: z.object({
    instanceName: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
    phoneNumber: z.string().optional(),
  }),
})

interface BotCtx {
  botRepo: BotRepository
  flowRepo: FlowRepository
  messaging: MessagingPort
  botService: BotService
}

export async function botRoutes(app: FastifyInstance, ctx: BotCtx) {
  app.addHook('preHandler', async (req) => {
    await req.jwtVerify()
  })

  app.get('/', async (req) => {
    const user = req.user as { id: string }
    return ctx.botRepo.findByOwnerId(user.id)
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })
    return bot.toJSON()
  })

  app.post('/', async (req, reply) => {
    const user = req.user as { id: string }
    const parsed = CreateBotSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const bot = await ctx.botService.createBot({
      ...parsed.data,
      ownerId: user.id,
      webhookBaseUrl: process.env.WEBHOOK_BASE_URL!,
    })

    return reply.code(201).send(bot.toJSON())
  })

  app.patch<{ Params: { id: string } }>('/:id/activate', async (req, reply) => {
    const user = req.user as { id: string }
    const { flowId } = req.body as { flowId: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    try {
      const updated = await ctx.botService.activateBot(bot.id, flowId)
      return updated.toJSON()
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to activate' })
    }
  })

  app.patch<{ Params: { id: string } }>('/:id/deactivate', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const updated = await ctx.botService.deactivateBot(bot.id)
    return updated.toJSON()
  })

  app.get<{ Params: { id: string } }>('/:id/qrcode', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const qrCode = await ctx.botService.getQRCode(bot.id, process.env.WEBHOOK_BASE_URL!)
    return { qrCode }
  })

  app.get<{ Params: { id: string } }>('/:id/connection-status', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const status = await ctx.messaging.getInstanceStatus(bot.evolutionConfig.instanceName)
    return { state: status.state }
  })

  app.patch<{ Params: { id: string }; Body: { rules: { tag: string; flowId: string }[] } }>(
    '/:id/routing-rules',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.id)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      bot.setRoutingRules(req.body.rules ?? [])
      await ctx.botRepo.save(bot)
      return bot.toJSON()
    }
  )

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    await ctx.messaging.deleteInstance(bot.evolutionConfig.instanceName)
    await ctx.botRepo.delete(bot.id)
    return reply.code(204).send()
  })
}
