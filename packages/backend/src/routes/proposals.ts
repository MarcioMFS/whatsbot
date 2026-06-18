import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { FlowRepository, BotRepository, FlowSegment } from '@whatsbot/core'
import type { PostgreSQLProposalRepository } from '../adapters/PostgreSQLProposalRepository.js'
import type { PostgreSQLFlowVersionRepository } from '../adapters/PostgreSQLFlowVersionRepository.js'
import type { SegmentGenerationService } from '../services/SegmentGenerationService.js'
import type { ImproverService } from '../services/ImproverService.js'

interface ProposalCtx {
  proposalRepo: PostgreSQLProposalRepository
  flowVersionRepo: PostgreSQLFlowVersionRepository
  flowRepo: FlowRepository
  botRepo: BotRepository
  segmentGen: SegmentGenerationService
  improver: ImproverService
  db: Pool
}

// Builder/Improver — GATE humano: IA propõe (flow_proposals), humano aprova/rejeita. Aprovar = snapshot
// (flow_versions) + apply. Tudo owner-gated. Sem isso, nada gerado por IA chega perto da produção.
export async function proposalRoutes(app: FastifyInstance, ctx: ProposalCtx) {
  app.addHook('preHandler', async (req) => { await req.jwtVerify() })

  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }
  // stamp de concorrência otimista: flows.updated_at no momento da geração vs no apply.
  const flowStamp = async (flowId: string): Promise<string | null> => {
    const { rows } = await ctx.db.query('SELECT updated_at FROM flows WHERE id = $1', [flowId])
    return rows[0]?.updated_at ? new Date(rows[0].updated_at as string).toISOString() : null
  }

  // Lista propostas de um bot (default: todas; ?status=pending pra fila de revisão).
  app.get<{ Params: { botId: string }; Querystring: { status?: string } }>('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    if (!await ownsBot(req.params.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    return { proposals: await ctx.proposalRepo.listByBot(req.params.botId, req.query.status) }
  })

  // Cria uma proposta (humano-iniciada via API, ou pelo ImproverService server-side no passo 4).
  app.post<{ Body: { botId: string; flowId?: string; kind: string; targetRuntime?: string; proposedContent: Record<string, unknown> } }>(
    '/',
    async (req, reply) => {
      const user = req.user as { id: string }
      const b = req.body
      if (!b?.botId || !b?.kind || !b?.proposedContent) return reply.code(400).send({ error: 'botId, kind e proposedContent são obrigatórios' })
      if (!await ownsBot(b.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
      const baselineStamp = b.flowId ? await flowStamp(b.flowId) : null
      const p = await ctx.proposalRepo.create({
        botId: b.botId, flowId: b.flowId ?? null, kind: b.kind, targetRuntime: b.targetRuntime ?? null,
        proposedContent: b.proposedContent, baselineStamp, createdBy: 'human',
      })
      return reply.code(201).send(p)
    },
  )

  // GERAÇÃO (passo 3): a IA cria uma proposta via cadeia FREE (NVIDIA→Groq), NÃO aplica — cai pending.
  app.post<{ Body: { botId: string; flowId: string; kind: string } }>('/generate', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId, flowId, kind } = req.body ?? {}
    if (!botId || !flowId || !kind) return reply.code(400).send({ error: 'botId, flowId e kind são obrigatórios' })
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const flow = await ctx.flowRepo.findById(flowId)
    if (!flow || flow.botId !== botId) return reply.code(404).send({ error: 'Not found' })

    if (kind === 'generate_segments') {
      let segments
      try {
        segments = await ctx.segmentGen.generate(flow) // via generateBuilder (NVIDIA free)
      } catch (err) {
        req.log.error(err)
        return reply.code(502).send({ error: 'Falha na geração pela IA' })
      }
      if (!segments.length) return reply.code(502).send({ error: 'IA não retornou segmentos válidos' })
      const p = await ctx.proposalRepo.create({
        botId, flowId, kind, targetRuntime: 'flow',
        proposedContent: { segments }, baselineStamp: await flowStamp(flowId), createdBy: 'ai',
      })
      return reply.code(201).send(p)
    }
    return reply.code(400).send({ error: `geração do kind "${kind}" ainda não suportada (passo 3 = generate_segments)` })
  })

  // IMPROVER (passo 4): observa sinais reais (mensagens não-entendidas + escalações) → IA propõe melhorias.
  app.post<{ Body: { botId: string; days?: number } }>('/improve', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId, days } = req.body ?? {}
    if (!botId) return reply.code(400).send({ error: 'botId é obrigatório' })
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    try {
      const { proposal, reason } = await ctx.improver.scan(botId, days ?? 7)
      if (!proposal) return reply.code(200).send({ proposal: null, reason })
      return reply.code(201).send(proposal)
    } catch (err) {
      req.log.error(err)
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'falha no improver' })
    }
  })

  // Aprova: valida dono → checa staleness → SNAPSHOT (flow_versions) → apply por kind → marca applied.
  app.post<{ Params: { id: string } }>('/:id/approve', async (req, reply) => {
    const user = req.user as { id: string }
    const p = await ctx.proposalRepo.findById(req.params.id)
    if (!p) return reply.code(404).send({ error: 'Not found' })
    if (!await ownsBot(p.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    if (p.status !== 'pending') return reply.code(409).send({ error: `proposta não está pendente (status=${p.status})` })

    if (!p.flowId) {
      return reply.code(400).send({ error: 'proposta sem flowId — geração de flow novo é passo 3+' })
    }

    // Concorrência otimista: se o flow mudou desde a geração, a proposta está obsoleta.
    const current = await flowStamp(p.flowId)
    if (p.baselineStamp && current && p.baselineStamp !== current) {
      await ctx.proposalRepo.markReviewed(p.id, 'stale', user.id)
      return reply.code(409).send({ error: 'flow mudou desde a geração — proposta obsoleta (stale), gere de novo' })
    }

    const flow = await ctx.flowRepo.findById(p.flowId)
    if (!flow) return reply.code(404).send({ error: 'flow não existe mais' })

    // SNAPSHOT antes de aplicar (rollback) — corrige o UPSERT destrutivo do FlowRepository.
    const snap = flow.toJSON()
    const version = await ctx.flowVersionRepo.snapshot({
      flowId: flow.id, nodes: snap.nodes, edges: snap.edges, segments: snap.segments,
      changedBy: user.id, reason: `pre-apply proposal ${p.id} (${p.kind})`,
    })

    // Apply por kind. Passo 2 cobre 'generate_segments' (reusa flow.setSegments). Outros kinds = passo 3.
    if (p.kind === 'generate_segments') {
      const segments = (p.proposedContent as { segments?: unknown }).segments
      if (!Array.isArray(segments)) return reply.code(400).send({ error: 'proposedContent.segments inválido' })
      const valid = new Set(flow.nodes.map(n => n.id))
      flow.setSegments((segments as FlowSegment[]).map(s => ({ ...s, nodeIds: (s.nodeIds ?? []).filter(id => valid.has(id)) })))
      await ctx.flowRepo.save(flow)
    } else {
      return reply.code(400).send({ error: `kind "${p.kind}" ainda não aplicável (passo 3); snapshot v${version} criado mas nada alterado` })
    }

    await ctx.proposalRepo.markReviewed(p.id, 'applied', user.id)
    return reply.send({ ok: true, applied: p.kind, snapshotVersion: version })
  })

  app.post<{ Params: { id: string } }>('/:id/reject', async (req, reply) => {
    const user = req.user as { id: string }
    const p = await ctx.proposalRepo.findById(req.params.id)
    if (!p) return reply.code(404).send({ error: 'Not found' })
    if (!await ownsBot(p.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    await ctx.proposalRepo.markReviewed(p.id, 'rejected', user.id)
    return reply.send({ ok: true })
  })
}
