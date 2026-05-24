import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PackageOffer } from '@whatsbot/core'
import type { PackageOfferRepository } from '@whatsbot/core'
import type { BotRepository } from '@whatsbot/core'

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  type: z.enum(['quantity_bundle', 'fixed_bundle']).default('quantity_bundle'),
  pricingMode: z.enum(['exact_quantity', 'minimum_quantity']).default('minimum_quantity'),
  quantity: z.number().int().positive(),
  priceCentavos: z.number().int().positive(),
  metadata: z.record(z.unknown()).optional(),
})

const UpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  pricingMode: z.enum(['exact_quantity', 'minimum_quantity']).optional(),
  quantity: z.number().int().positive().optional(),
  priceCentavos: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
})

interface Ctx {
  packageOfferRepo: PackageOfferRepository
  botRepo: BotRepository
}

export async function packageOfferRoutes(app: FastifyInstance, ctx: Ctx) {
  app.addHook('preHandler', async (req) => { await req.jwtVerify() })

  // List offers for a bot
  app.get<{ Params: { botId: string }; Querystring: { includeInactive?: string } }>(
    '/bot/:botId',
    async (req, reply) => {
      const user = req.user as { id: string }
      const bot = await ctx.botRepo.findById(req.params.botId)
      if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

      const includeInactive = req.query.includeInactive === 'true'
      const offers = await ctx.packageOfferRepo.findByBotId(req.params.botId, includeInactive)
      return offers.map(o => o.toJSON())
    },
  )

  // Create offer
  app.post<{ Params: { botId: string } }>('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const bot = await ctx.botRepo.findById(req.params.botId)
    if (!bot || bot.ownerId !== user.id) return reply.code(404).send({ error: 'Not found' })

    const parsed = CreateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const offer = PackageOffer.create({ botId: req.params.botId, ...parsed.data })
    await ctx.packageOfferRepo.save(offer)
    return reply.code(201).send(offer.toJSON())
  })

  // Update offer
  app.put<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const parsed = UpdateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const offer = await ctx.packageOfferRepo.findById(req.params.id)
    if (!offer) return reply.code(404).send({ error: 'Not found' })

    offer.update(parsed.data)
    await ctx.packageOfferRepo.save(offer)
    return offer.toJSON()
  })

  // Toggle active
  app.patch<{ Params: { id: string } }>('/:id/toggle', async (req, reply) => {
    const offer = await ctx.packageOfferRepo.findById(req.params.id)
    if (!offer) return reply.code(404).send({ error: 'Not found' })

    offer.update({ isActive: !offer.isActive })
    await ctx.packageOfferRepo.save(offer)
    return offer.toJSON()
  })

  // Delete offer
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await ctx.packageOfferRepo.delete(req.params.id)
    return reply.code(204).send()
  })
}
