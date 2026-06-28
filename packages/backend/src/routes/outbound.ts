import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { BotRepository, MessagingPort } from '@whatsbot/core'

// Envio programático (outbound) — usado pelos lembretes do Vox (Phase 8). Mais simples/robusto
// que o MCP num cron: auth pelo mesmo token de mcp_clients (escopo 'send'), ownership por construção.

interface OutboundDeps {
  db: Pool
  botRepo: BotRepository
  messaging: MessagingPort
}

export async function outboundRoutes(app: FastifyInstance, deps: OutboundDeps) {
  app.post('/send', async (req, reply) => {
    const authHeader = req.headers['authorization']
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    if (!token) return reply.code(401).send({ error: 'unauthorized' })

    const { rows } = await deps.db.query('SELECT owner_id, allowed_bots, scopes FROM mcp_clients WHERE token = $1', [token])
    const client = rows[0]
    if (!client) return reply.code(401).send({ error: 'unauthorized' })
    const scopes = (client.scopes as string[]) ?? []
    if (!scopes.includes('send')) return reply.code(403).send({ error: 'scope "send" required' })

    const body = req.body as { botId?: string; to?: string; text?: string }
    if (!body.botId || !body.to || !body.text) return reply.code(400).send({ error: 'botId, to, text required' })

    const bot = await deps.botRepo.findById(body.botId)
    if (!bot || bot.ownerId !== client.owner_id) return reply.code(404).send({ error: 'bot not found' })
    const allowed = (client.allowed_bots as string[] | null) ?? null
    if (allowed && !allowed.includes(body.botId)) return reply.code(403).send({ error: 'bot out of scope' })

    try {
      await deps.messaging.sendMessage({ instanceName: bot.evolutionConfig.instanceName, phoneNumber: body.to, message: body.text })
      return reply.send({ sent: true })
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'send failed' })
    }
  })
}
