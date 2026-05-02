import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Flow, type FlowRepository, type BotRepository } from '@whatsbot/core'

const SaveFlowSchema = z.object({
  name: z.string().min(1),
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.record(z.unknown()),
  })),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    sourceHandle: z.string().nullable().optional(),
    target: z.string(),
    targetHandle: z.string().nullable().optional(),
    label: z.string().optional(),
  })),
})

interface FlowCtx {
  flowRepo: FlowRepository
  botRepo: BotRepository
}

export async function flowRoutes(app: FastifyInstance, ctx: FlowCtx) {
  app.addHook('preHandler', async (req) => {
    await req.jwtVerify()
  })

  app.get<{ Params: { botId: string } }>('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    return ctx.flowRepo.findByBotId(req.params.botId)
  })

  app.post<{ Params: { botId: string } }>('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const parsed = SaveFlowSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const flow = Flow.create({ botId: bot.id, name: parsed.data.name })
    flow.updateNodes(parsed.data.nodes as ReturnType<Flow['toJSON']>['nodes'], parsed.data.edges as ReturnType<Flow['toJSON']>['edges'])

    await ctx.flowRepo.save(flow)
    return reply.code(201).send(flow.toJSON())
  })

  app.put<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const parsed = SaveFlowSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const flow = await ctx.flowRepo.findById(req.params.id)
    if (!flow) return reply.code(404).send({ error: 'Not found' })

    flow.updateNodes(parsed.data.nodes as ReturnType<Flow['toJSON']>['nodes'], parsed.data.edges as ReturnType<Flow['toJSON']>['edges'])
    await ctx.flowRepo.save(flow)
    return flow.toJSON()
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await ctx.flowRepo.delete(req.params.id)
    return reply.code(204).send()
  })
}
