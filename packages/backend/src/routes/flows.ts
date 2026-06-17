import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Flow, type FlowRepository, type BotRepository, type FlowSegment } from '@whatsbot/core'
import type { SegmentGenerationService } from '../services/SegmentGenerationService.js'

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

const SegmentsSchema = z.object({
  segments: z.array(z.object({
    id: z.string(),
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(500),
    whenToUse: z.string().max(500).optional(),
    nodeIds: z.array(z.string()).max(200),
    generated: z.boolean().optional(),
    escapeMode: z.enum(['inherit', 'off', 'cover', 'handoff']).optional(),
    escapeHint: z.string().max(500).optional(),
  })).max(40),
})

interface FlowCtx {
  flowRepo: FlowRepository
  botRepo: BotRepository
  segmentGen: SegmentGenerationService
}

export async function flowRoutes(app: FastifyInstance, ctx: FlowCtx) {
  app.addHook('preHandler', async (req) => {
    await req.jwtVerify()
  })

  // Carrega o flow garantindo que o dono logado é o do bot. Retorna null se não autorizado.
  const ownedFlow = async (flowId: string, userId: string): Promise<Flow | null> => {
    const flow = await ctx.flowRepo.findById(flowId)
    if (!flow) return null
    const bot = await ctx.botRepo.findById(flow.botId)
    if (!bot || bot.ownerId !== userId) return null
    return flow
  }

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
    const user = req.user as { id: string }
    const parsed = SaveFlowSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    // #sec: exige dono do bot — antes qualquer user autenticado sobrescrevia flow alheio por UUID
    const flow = await ownedFlow(req.params.id, user.id)
    if (!flow) return reply.code(404).send({ error: 'Not found' })

    flow.updateNodes(parsed.data.nodes as ReturnType<Flow['toJSON']>['nodes'], parsed.data.edges as ReturnType<Flow['toJSON']>['edges'])
    await ctx.flowRepo.save(flow)
    return flow.toJSON()
  })

  // ── Segmentos descritos (Habilidades) — ver Brain/spec_skills_segmentos.md ──

  // Lista os segmentos salvos do flow.
  app.get<{ Params: { id: string } }>('/:id/segments', async (req, reply) => {
    const user = req.user as { id: string }
    const flow = await ownedFlow(req.params.id, user.id)
    if (!flow) return reply.code(404).send({ error: 'Not found' })
    return { segments: flow.segments }
  })

  // Gera uma PROPOSTA de segmentos via IA (não persiste — humano revisa e salva via PUT).
  app.post<{ Params: { id: string } }>('/:id/segments/generate', async (req, reply) => {
    const user = req.user as { id: string }
    const flow = await ownedFlow(req.params.id, user.id)
    if (!flow) return reply.code(404).send({ error: 'Not found' })
    try {
      const segments = await ctx.segmentGen.generate(flow)
      return { segments }
    } catch (err) {
      req.log.error(err)
      return reply.code(502).send({ error: 'Falha ao gerar segmentos com IA' })
    }
  })

  // Salva os segmentos revisados.
  app.put<{ Params: { id: string } }>('/:id/segments', async (req, reply) => {
    const user = req.user as { id: string }
    const flow = await ownedFlow(req.params.id, user.id)
    if (!flow) return reply.code(404).send({ error: 'Not found' })

    const parsed = SegmentsSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const valid = new Set(flow.nodes.map(n => n.id))
    const segments: FlowSegment[] = parsed.data.segments.map(s => ({
      ...s,
      nodeIds: s.nodeIds.filter(id => valid.has(id)),
    }))
    flow.setSegments(segments)
    await ctx.flowRepo.save(flow)
    return { segments: flow.segments }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    // #sec: exige dono do bot — antes deletava flow de qualquer bot só com o UUID, sem checagem
    const flow = await ownedFlow(req.params.id, user.id)
    if (!flow) return reply.code(404).send({ error: 'Not found' })

    await ctx.flowRepo.delete(req.params.id)
    return reply.code(204).send()
  })
}
