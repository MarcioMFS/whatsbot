import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'fs'
import { join as joinPath } from 'path'
import type { BotRepository } from '@whatsbot/core'
import { RECEIPTS_DIR } from '../services/FlowExecutionService.js'

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ReceiptsCtx {
  botRepo: BotRepository
}

// Comprovantes de pagamento aprovados (1 arquivo por PaymentIntent). Dados
// sensíveis: nunca no public do frontend — só aqui, atrás do JWT + dono do bot.
export async function receiptRoutes(app: FastifyInstance, ctx: ReceiptsCtx) {
  app.addHook('preHandler', async (req) => {
    await req.jwtVerify()
  })

  app.get<{ Params: { botId: string; intentId: string } }>(
    '/:botId/:intentId',
    async (req, reply) => {
      const user = req.user as { id: string }
      const { botId, intentId } = req.params
      // #sec path traversal: só UUIDs formam o caminho do arquivo
      if (!UUID_RX.test(botId) || !UUID_RX.test(intentId)) return reply.code(404).send({ error: 'Not found' })

      const bot = await ctx.botRepo.findById(botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      try {
        const buf = readFileSync(joinPath(RECEIPTS_DIR, botId, `${intentId}.jpg`))
        return reply.type('image/jpeg').send(buf)
      } catch {
        return reply.code(404).send({ error: 'Not found' })
      }
    }
  )
}
