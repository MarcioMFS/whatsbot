import type { FastifyPluginCallback } from 'fastify'
import { Capability } from '@whatsbot/core'
import type { CapabilityRepository, BotRepository } from '@whatsbot/core'
import type { CapabilityRouter } from '../services/CapabilityRouter.js'
import type { PatternDetector } from '../services/PatternDetector.js'

interface CapabilitiesCtx {
  capabilityRepo: CapabilityRepository
  capabilityRouter: CapabilityRouter
  patternDetector: PatternDetector
  botRepo: BotRepository
}

export const capabilitiesRoutes: FastifyPluginCallback<CapabilitiesCtx> = (fastify, ctx, done) => {
  // #sec: antes sem autenticação NEM ownership — anônimo lia/criava/editava capabilities de qualquer bot
  // (POST com flowId malicioso sequestrava conversas). Hardening extra do flowId cross-bot fica em
  // FlowExecutionService (capFlow.botId === bot.id).
  fastify.addHook('preHandler', async (req) => { await req.jwtVerify() })

  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }
  const ownedCap = async (id: string, userId: string): Promise<Capability | null> => {
    const cap = await ctx.capabilityRepo.findById(id)
    if (!cap) return null
    return (await ownsBot(cap.botId, userId)) ? cap : null
  }

  // GET /bot/:botId — list all capabilities for a bot
  fastify.get('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const caps = await ctx.capabilityRepo.findByBotId(botId)
    return reply.send(caps.map(c => c.toJSON()))
  })

  // GET /bot/:botId/metrics — routing metrics
  fastify.get('/bot/:botId/metrics', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const { days = '7' } = req.query as { days?: string }
    const metrics = await ctx.patternDetector.getCapabilityMetrics(botId, parseInt(days))
    return reply.send(metrics)
  })

  // GET /bot/:botId/patterns — detected problematic patterns
  fastify.get('/bot/:botId/patterns', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const { days = '7' } = req.query as { days?: string }
    const patterns = await ctx.patternDetector.detectPatterns(botId, parseInt(days))
    return reply.send(patterns)
  })

  // GET /:id — single capability
  fastify.get('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const cap = await ownedCap(id, user.id)
    if (!cap) return reply.status(404).send({ error: 'Capability not found' })
    return reply.send(cap.toJSON())
  })

  // POST /bot/:botId — create capability
  fastify.post('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const body = req.body as {
      name: string
      description: string
      examples: string[]
      exclusions?: string[]
      triggers?: Array<{ type: string; value: string; priority: number }>
      flowId: string
      isDefault?: boolean
      isEnabled?: boolean
      priority?: number
      metadata?: Record<string, unknown>
    }

    if (!body.name || !body.description || !body.flowId) {
      return reply.status(400).send({ error: 'name, description, and flowId are required' })
    }
    if (!body.examples || body.examples.length === 0) {
      return reply.status(400).send({ error: 'At least 1 example is required' })
    }

    if (body.isDefault) {
      await ctx.capabilityRepo.clearDefault(botId)
    }

    const cap = Capability.create({
      botId,
      name: body.name,
      description: body.description,
      examples: body.examples,
      exclusions: body.exclusions ?? [],
      triggers: (body.triggers ?? []) as Array<{ type: 'keyword' | 'phrase' | 'state' | 'tag'; value: string; priority: number }>,
      flowId: body.flowId,
      isDefault: body.isDefault ?? false,
      isEnabled: body.isEnabled ?? true,
      priority: body.priority ?? 50,
      metadata: body.metadata ?? {},
    })

    await ctx.capabilityRepo.save(cap)
    ctx.capabilityRouter.invalidateCache(botId)

    return reply.status(201).send(cap.toJSON())
  })

  // PUT /:id — update capability
  fastify.put('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const cap = await ownedCap(id, user.id)
    if (!cap) return reply.status(404).send({ error: 'Capability not found' })

    const body = req.body as Record<string, unknown>

    if (body.isDefault && !cap.isDefault) {
      await ctx.capabilityRepo.clearDefault(cap.botId)
    }

    const updated = await ctx.capabilityRepo.update(id, body as Parameters<CapabilityRepository['update']>[1])
    ctx.capabilityRouter.invalidateCache(cap.botId)

    return reply.send(updated.toJSON())
  })

  // PATCH /:id/toggle — enable/disable
  fastify.patch('/:id/toggle', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const cap = await ownedCap(id, user.id)
    if (!cap) return reply.status(404).send({ error: 'Capability not found' })

    const updated = await ctx.capabilityRepo.update(id, { isEnabled: !cap.isEnabled })
    ctx.capabilityRouter.invalidateCache(cap.botId)

    return reply.send(updated.toJSON())
  })

  // DELETE /:id
  fastify.delete('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const cap = await ownedCap(id, user.id)
    if (!cap) return reply.status(404).send({ error: 'Capability not found' })

    await ctx.capabilityRepo.delete(id)
    ctx.capabilityRouter.invalidateCache(cap.botId)

    return reply.status(204).send()
  })

  done()
}
