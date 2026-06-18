import type { FastifyPluginCallback } from 'fastify'
import { Product } from '@whatsbot/core'
import type { ProductRepository, BotRepository } from '@whatsbot/core'

interface ProductCtx {
  productRepo: ProductRepository
  botRepo: BotRepository
}

export const productRoutes: FastifyPluginCallback<ProductCtx> = (fastify, ctx, done) => {
  // #sec: antes este plugin não tinha autenticação NEM ownership — qualquer anônimo lia/editava/apagava
  // o catálogo de qualquer bot por botId/UUID.
  fastify.addHook('preHandler', async (req) => { await req.jwtVerify() })

  const ownsBot = async (botId: string, userId: string): Promise<boolean> => {
    const bot = await ctx.botRepo.findById(botId)
    return !!bot && bot.ownerId === userId
  }
  const ownedProduct = async (id: string, userId: string): Promise<Product | null> => {
    const product = await ctx.productRepo.findById(id)
    if (!product) return null
    return (await ownsBot(product.botId, userId)) ? product : null
  }

  // List products for a bot
  fastify.get('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const { includeUnavailable } = req.query as { includeUnavailable?: string }
    const products = await ctx.productRepo.findByBotId(botId, includeUnavailable === 'true')
    return reply.send(products.map(p => p.toJSON()))
  })

  // Create product
  fastify.post('/bot/:botId', async (req, reply) => {
    const user = req.user as { id: string }
    const { botId } = req.params as { botId: string }
    if (!await ownsBot(botId, user.id)) return reply.code(404).send({ error: 'Not found' })
    const body = req.body as {
      name: string
      description?: string
      priceCentavos: number
      category?: string
      accessLink?: string
      aliases?: string[]
      metadata?: Record<string, unknown>
    }

    const product = Product.create({
      botId,
      name: body.name,
      description: body.description,
      priceCentavos: body.priceCentavos,
      category: body.category,
      accessLink: body.accessLink,
      aliases: body.aliases ?? [],
      metadata: body.metadata ?? {},
    })
    await ctx.productRepo.save(product)
    return reply.code(201).send(product.toJSON())
  })

  // Get product
  fastify.get('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const product = await ownedProduct(id, user.id)
    if (!product) return reply.code(404).send({ error: 'Product not found' })
    return reply.send(product.toJSON())
  })

  // Update product
  fastify.put('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const product = await ownedProduct(id, user.id)
    if (!product) return reply.code(404).send({ error: 'Product not found' })

    const body = req.body as {
      name?: string
      description?: string
      priceCentavos?: number
      category?: string
      accessLink?: string
      aliases?: string[]
      isAvailable?: boolean
      metadata?: Record<string, unknown>
    }

    product.updateInfo({
      name: body.name,
      description: body.description,
      priceCentavos: body.priceCentavos,
      category: body.category,
      accessLink: body.accessLink,
      metadata: body.metadata,
    })
    if (body.isAvailable !== undefined) product.setAvailability(body.isAvailable)
    if (body.aliases !== undefined) product.setAliases(body.aliases)

    await ctx.productRepo.save(product)
    return reply.send(product.toJSON())
  })

  // Delete product
  fastify.delete('/:id', async (req, reply) => {
    const user = req.user as { id: string }
    const { id } = req.params as { id: string }
    const product = await ownedProduct(id, user.id)
    if (!product) return reply.code(404).send({ error: 'Product not found' })
    await ctx.productRepo.delete(id)
    return reply.code(204).send()
  })

  done()
}
