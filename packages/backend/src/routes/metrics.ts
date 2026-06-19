import type { FastifyInstance } from 'fastify'
import type { BotRepository } from '@whatsbot/core'
import type { MetricsAggregator } from '../services/MetricsAggregator.js'
import type { PatternDistiller } from '../services/PatternDistiller.js'
import type { PatternPerformanceService } from '../services/PatternPerformanceService.js'

interface MetricsCtx {
  aggregator: MetricsAggregator
  distiller: PatternDistiller
  performance: PatternPerformanceService
  botRepo: BotRepository
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
