import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { BotRepository, FlowRepository, MessagingPort, ConversationEventRepository, BotGlobalConfig, AgentTraceRepository } from '@whatsbot/core'
import type { BotService } from '../services/BotService.js'
import { GlobalConfigSchema, buildBotPersonaPreview, invalidatePersonaCache } from '../services/BotPersonaBuilder.js'
import { ModuleRegistry } from '../services/ModuleRegistry.js'

// Registro é stateless (só o catálogo de defs) — uma instância serve todas as requisições.
const moduleRegistry = new ModuleRegistry()

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
  eventRepo?: ConversationEventRepository
  agentTrace: AgentTraceRepository
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
    return bot.toPublicJSON()
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

    return reply.code(201).send(bot.toPublicJSON())
  })

  app.patch<{ Params: { id: string } }>('/:id/activate', async (req, reply) => {
    const user = req.user as { id: string }
    const { flowId } = req.body as { flowId: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    try {
      const updated = await ctx.botService.activateBot(bot.id, flowId)
      return updated.toPublicJSON()
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to activate' })
    }
  })

  app.patch<{ Params: { id: string } }>('/:id/deactivate', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const updated = await ctx.botService.deactivateBot(bot.id)
    return updated.toPublicJSON()
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
      return bot.toPublicJSON()
    }
  )

  app.patch<{ Params: { id: string } }>('/:id/config', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    bot.updateGlobalConfig(req.body as Partial<BotGlobalConfig>)
    await ctx.botRepo.save(bot)
    return bot.toPublicJSON()
  })

  // (global-config endpoint abaixo retorna preview próprio)

  // Dedicated global-config endpoint: validated, sanitized, with preview + cache invalidation
  app.patch<{ Params: { id: string } }>('/:id/global-config', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const parsed = GlobalConfigSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() })

    bot.updateGlobalConfig(parsed.data)
    await ctx.botRepo.save(bot)
    invalidatePersonaCache(bot.id)

    return {
      config: bot.globalConfig,
      preview: buildBotPersonaPreview(bot.globalConfig),
    }
  })

  // Registro de Módulos resolvido por bot: cada def + estado (enabled) + config (com fallback ao blob legado).
  // A aba "Módulos" do Centro de Controle renderiza isto. Ver Brain/spec_centro_de_controle_F5.md.
  app.get<{ Params: { id: string } }>('/:id/modules', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const modules = moduleRegistry.definitions().map(def => ({
      ...def,
      enabled: moduleRegistry.isEnabled(bot, def.id),
      config: moduleRegistry.configFor(bot, def.id),
    }))
    return { modules }
  })

  // Trilha do agente (bot-level): feed recente de tool-calls/replies/nudges. Auditoria "quem/como".
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/:id/agent-trace', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })
    const limit = Math.min(Number(req.query.limit ?? 100), 500)
    return { trace: await ctx.agentTrace.listByBot(bot.id, limit) }
  })

  app.get<{ Params: { id: string } }>('/:id/global-config/preview', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.id)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })
    return buildBotPersonaPreview(bot.globalConfig)
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string; type?: string } }>(
    '/:id/events',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.id)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const limit = Math.min(parseInt(req.query.limit ?? '200', 10), 500)
      const events = await ctx.eventRepo?.findByBot(req.params.id, limit) ?? []
      return { events }
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
