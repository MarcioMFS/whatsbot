import type { FastifyInstance } from 'fastify'
import type { BotRepository } from '@whatsbot/core'
import type { MetricsAggregator } from '../services/MetricsAggregator.js'
import type { PatternDistiller } from '../services/PatternDistiller.js'
import type { PatternPerformanceService } from '../services/PatternPerformanceService.js'

import type { Pool } from 'pg'
import type { FlowRepository } from '@whatsbot/core'

interface MetricsCtx {
  aggregator: MetricsAggregator
  distiller: PatternDistiller
  performance: PatternPerformanceService
  botRepo: BotRepository
  flowRepo?: FlowRepository
  db?: Pool
}

// F1 — painel de funil. READ-ONLY. O dono vê o funil do PRÓPRIO bot + o funil GLOBAL anônimo
// (só contagens agregadas, sem PII, sem identificar outro tenant). Ver Brain/spec_gerador_evolutivo.md.
export async function metricsRoutes(app: FastifyInstance, ctx: MetricsCtx) {
  app.addHook('preHandler', async (req) => { await req.jwtVerify() })

  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }
  const clampDays = (d: unknown): number => Math.min(Math.max(Number(d) || 30, 1), 365)

  // Funil node-a-node do flow ativo (funis roteirizados): leads distintos que alcançaram
  // cada marco (perguntas/pix/pagamento) da coluna principal do flow (convenção: x<=150;
  // remarketing/entrega ficam nas colunas à direita). Ordenado pela posição vertical.
  app.get<{ Params: { botId: string }; Querystring: { days?: string } }>('/flow-funnel/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })
    if (!ctx.flowRepo || !ctx.db) return reply.code(501).send({ error: 'flow-funnel indisponível' })
    const flow = bot.activeFlowId ? await ctx.flowRepo.findById(bot.activeFlowId) : null
    if (!flow) return { stages: [], windowDays: 0 }

    const windowDays = clampDays(req.query.days)
    const milestones = flow.nodes
      .filter(n => ['capture', 'pix', 'payment_confirmed'].includes(n.type) && (n.position?.x ?? 999) <= 150)
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
      .map(n => ({ id: n.id, label: (n.data as { label?: string }).label ?? n.id }))

    const ids = milestones.map(m => m.id)
    const { rows } = await ctx.db.query(
      `SELECT payload->>'nodeId' AS nid, count(DISTINCT phone_number) AS c
       FROM conversation_events
       WHERE bot_id = $1 AND event_type = 'node_reached'
         AND occurred_at > now() - ($2 || ' days')::interval
         AND payload->>'nodeId' = ANY($3)
       GROUP BY 1`,
      [bot.id, String(windowDays), ids]
    )
    const { rows: started } = await ctx.db.query(
      `SELECT count(DISTINCT phone_number) AS c FROM conversation_events
       WHERE bot_id = $1 AND event_type = 'flow_started'
         AND occurred_at > now() - ($2 || ' days')::interval`,
      [bot.id, String(windowDays)]
    )
    const byId = new Map(rows.map(r => [r.nid as string, Number(r.c)]))
    const stages = [
      { id: 'entrada', label: 'Entraram no funil', count: Number(started[0]?.c ?? 0) },
      ...milestones.map(m => ({ ...m, count: byId.get(m.id) ?? 0 })),
    ]
    return { windowDays, stages }
  })

  // Funil do bot do dono + funil global anônimo (agregado de todos os bots, só counts).
  app.get<{ Params: { botId: string }; Querystring: { days?: string } }>('/funnel/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    if (!await ownsBot(req.params.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const windowDays = clampDays(req.query.days)
    const [bot, global] = await Promise.all([
      ctx.aggregator.computeFunnel({ botId: req.params.botId, windowDays }),
      ctx.aggregator.computeFunnel({ windowDays }),
    ])
    // higiene de privacidade: só revela o global se ≥2 bots contribuíram (senão ≈ 1 tenant).
    return { bot, global: global.botsContributing >= 2 ? global : null, globalSuppressed: global.botsContributing < 2 }
  })

  // Dispara a materialização do funnel_metrics (consumido pelo F2). Agregado read-only.
  app.post<{ Body: { days?: number } }>('/refresh', async (req, reply) => {
    const user = req.user as { id: string }
    if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' })
    const r = await ctx.aggregator.refresh(clampDays(req.body?.days))
    return { ok: true, ...r }
  })

  // F2 — store de padrões vencedores (seed do playbook + destilados). O que o F3 vai consumir.
  app.get<{ Querystring: { vertical?: string } }>('/patterns', async (req, reply) => {
    const user = req.user as { id: string }
    if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' })
    return { patterns: await ctx.distiller.getPatternsForGeneration(req.query.vertical) }
  })

  // F2 — roda a destilação (offline, free). Hoje retorna [] honesto (sem volume). Owner autenticado.
  app.post<{ Body: { days?: number } }>('/distill', async (req, reply) => {
    const user = req.user as { id: string }
    if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' })
    return ctx.distiller.distill(clampDays(req.body?.days))
  })

  // F5 — auditoria: quais padrões alimentaram cada flow GERADO do bot (owner-gated).
  app.get<{ Params: { botId: string } }>('/audit/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    if (!await ownsBot(req.params.botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    return { flows: await ctx.distiller.auditBot(req.params.botId) }
  })

  // F4 — conversão por versão de padrões (qual conjunto converte mais). Read-only.
  app.get<{ Querystring: { days?: string } }>('/performance', async (req, reply) => {
    const user = req.user as { id: string }
    if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' })
    return ctx.performance.evaluateVersions(clampDays(req.query.days))
  })

  // F4 — roda a decisão promover/aposentar padrões por dado. Hoje no-op honesto (sem candidates/volume).
  app.post<{ Body: { days?: number } }>('/promote', async (req, reply) => {
    const user = req.user as { id: string }
    if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' })
    return ctx.performance.run(clampDays(req.body?.days))
  })
}
