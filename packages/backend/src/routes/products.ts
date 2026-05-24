import type { FastifyPluginCallback } from 'fastify'
import { Product } from '@whatsbot/core'
import type { ProductRepository } from '@whatsbot/core'

interface ProductCtx {
  productRepo: ProductRepository
}

export const productRoutes: FastifyPluginCallback<ProductCtx> = (fastify, ctx, done) => {
  // List products for a bot
  fastify.get('/bot/:botId', async (req, reply) => {
    const { botId } = req.params as { botId: string }
    const { includeUnavailable } = req.query as { includeUnavailable?: string }
    const products = await ctx.productRepo.findByBotId(botId, includeUnavailable === 'true')
    return reply.send(products.map(p => p.toJSON()))
  })

  // Create product
  fastify.post('/bot/:botId', async (req, reply) => {
    const { botId } = req.params as { botId: string }
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
    const { id } = req.params as { id: string }
    const product = await ctx.productRepo.findById(id)
    if (!product) return reply.code(404).send({ error: 'Product not found' })
    return reply.send(product.toJSON())
  })

  // Update product
  fastify.put('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const product = await ctx.productRepo.findById(id)
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
    const { id } = req.params as { id: string }
    await ctx.productRepo.delete(id)
    return reply.code(204).send()
  })

  done()
}
