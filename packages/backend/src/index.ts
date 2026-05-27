import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { Pool } from 'pg'
import Redis from 'ioredis'

import { authRoutes } from './routes/auth.js'
import { aiRoutes } from './routes/ai.js'
import { botRoutes } from './routes/bots.js'
import { flowRoutes } from './routes/flows.js'
import { conversationRoutes } from './routes/conversations.js'
import { webhookRoutes } from './routes/webhooks.js'
import { PostgreSQLBotRepository } from './adapters/PostgreSQLBotRepository.js'
import { PostgreSQLFlowRepository } from './adapters/PostgreSQLFlowRepository.js'
import { RedisConversationRepository } from './adapters/RedisConversationRepository.js'
import { EvolutionAPIAdapter } from './adapters/EvolutionAPIAdapter.js'
import { ClaudeAdapter } from './adapters/ClaudeAdapter.js'
import { GroqAdapter } from './adapters/GroqAdapter.js'
import { BotService } from './services/BotService.js'
import { FlowExecutionService } from './services/FlowExecutionService.js'
import { AIGenerationService } from './services/AIGenerationService.js'
import { TimeoutService } from './services/TimeoutService.js'
import { startMessageWorker } from './queue/messageWorker.js'
import { PostgreSQLLeadRepository } from './adapters/PostgreSQLLeadRepository.js'
import { PostgreSQLConversationEventRepository } from './adapters/PostgreSQLConversationEventRepository.js'
import { PostgreSQLPaymentIntentRepository } from './adapters/PostgreSQLPaymentIntentRepository.js'
import { PostgreSQLProductRepository } from './adapters/PostgreSQLProductRepository.js'
import { PostgreSQLOrderRepository } from './adapters/PostgreSQLOrderRepository.js'
import { PostgreSQLPackageOfferRepository } from './adapters/PostgreSQLPackageOfferRepository.js'
import { CatalogSearchService } from './services/CatalogSearchService.js'
import { ContextualAIRouter } from './services/ContextualAIRouter.js'
import { PaymentPhaseRouter } from './services/PaymentPhaseRouter.js'
import { PostgreSQLAIDecisionRepository } from './adapters/PostgreSQLAIDecisionRepository.js'
import { PaymentOrchestrator } from './payment/PaymentOrchestrator.js'
import { ReceiptExtractorAI } from './payment/ReceiptExtractorAI.js'
import { PostgreSQLUsedTransactionRepository } from './adapters/PostgreSQLUsedTransactionRepository.js'
import { InternalEventBus } from './events/InternalEventBus.js'
import { DeliveryService } from './services/DeliveryService.js'
import { leadRoutes } from './routes/leads.js'
import { productRoutes } from './routes/products.js'
import { orderRoutes } from './routes/orders.js'
import { packageOfferRoutes } from './routes/packageOffers.js'
import { handoffRoutes } from './routes/handoffs.js'
import { PostgreSQLHandoffRepository } from './adapters/PostgreSQLHandoffRepository.js'
import { paymentIntentRoutes } from './routes/paymentIntents.js'

const requiredEnv = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'EVOLUTION_URL', 'EVOLUTION_API_KEY']
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
}

const app = Fastify({ logger: true })

const db = new Pool({ connectionString: process.env.DATABASE_URL })
const redis = new Redis(process.env.REDIS_URL!)

const botRepo = new PostgreSQLBotRepository(db)
const flowRepo = new PostgreSQLFlowRepository(db)
const conversationRepo = new RedisConversationRepository(redis, db)
const leadRepo = new PostgreSQLLeadRepository(db)
const eventRepo = new PostgreSQLConversationEventRepository(db)
const paymentIntentRepo = new PostgreSQLPaymentIntentRepository(db)

const messaging = new EvolutionAPIAdapter(
  process.env.EVOLUTION_URL!,
  process.env.EVOLUTION_API_KEY!,
)

const aiProviders = {
  claude: process.env.CLAUDE_API_KEY ? new ClaudeAdapter(process.env.CLAUDE_API_KEY) : null,
  groq: (() => {
    const keys = [
      process.env.GROQ_API_KEY,
      process.env.GROQ_API_KEY_2,
      process.env.GROQ_API_KEY_3,
      process.env.GROQ_API_KEY_4,
      process.env.GROQ_API_KEY_5,
      process.env.GROQ_API_KEY_6,
    ].filter(Boolean) as string[]
    return keys.length ? new GroqAdapter(keys) : null
  })(),
}

const productRepo = new PostgreSQLProductRepository(db)
const orderRepo = new PostgreSQLOrderRepository(db)
const packageOfferRepo = new PostgreSQLPackageOfferRepository(db)
const handoffRepo = new PostgreSQLHandoffRepository(db)

const aiService = new AIGenerationService(aiProviders)
const aiDecisionRepo = new PostgreSQLAIDecisionRepository(db)
const catalogSearchService = new CatalogSearchService(productRepo, aiService, aiDecisionRepo)
const contextualAIRouter = new ContextualAIRouter(aiService, aiDecisionRepo)
const paymentPhaseRouter = new PaymentPhaseRouter(aiService, aiDecisionRepo)
const usedTransactionRepo = new PostgreSQLUsedTransactionRepository(db)
const eventBus = new InternalEventBus(db)
const claudeProvider = aiProviders.claude
if (!claudeProvider) throw new Error('CLAUDE_API_KEY required for receipt validation')
const receiptExtractor = new ReceiptExtractorAI(claudeProvider)
const paymentOrchestrator = new PaymentOrchestrator(receiptExtractor, paymentIntentRepo, usedTransactionRepo, eventBus)
const deliveryService = new DeliveryService(messaging, eventRepo)
const flowExecService = new FlowExecutionService(
  flowRepo, conversationRepo, leadRepo, messaging, aiService,
  eventRepo, paymentOrchestrator, paymentIntentRepo,
  catalogSearchService, productRepo, orderRepo, deliveryService, packageOfferRepo, handoffRepo,
  contextualAIRouter, paymentPhaseRouter,
)
const botService = new BotService(botRepo, flowRepo, messaging)
const timeoutService = new TimeoutService(conversationRepo, botRepo, flowRepo, messaging, flowExecService, leadRepo, eventRepo)
timeoutService.start()

await app.register(cors, { origin: process.env.FRONTEND_URL ?? '*' })
await app.register(jwt, { secret: process.env.JWT_SECRET! })
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

const ctx = { botRepo, flowRepo, conversationRepo, leadRepo, botService, flowExecService, messaging, redis, eventRepo }

await app.register(authRoutes, { prefix: '/api/auth', db })
await app.register(aiRoutes, { prefix: '/api/ai', aiService })
await app.register(botRoutes, { prefix: '/api/bots', ...ctx })
await app.register(flowRoutes, { prefix: '/api/flows', ...ctx })
await app.register(conversationRoutes, { prefix: '/api/conversations', ...ctx })
await app.register(leadRoutes, { prefix: '/api/leads', ...ctx })
await app.register(productRoutes, { prefix: '/api/products', productRepo })
await app.register(orderRoutes, { prefix: '/api/orders', orderRepo })
await app.register(packageOfferRoutes, { prefix: '/api/package-offers', packageOfferRepo, botRepo })
await app.register(handoffRoutes, { prefix: '/api/handoffs', handoffRepo, convRepo: conversationRepo, botRepo, messaging })
await app.register(paymentIntentRoutes, { prefix: '/api/payment-intents', paymentIntentRepo })
await app.register(webhookRoutes, { prefix: '/webhooks', ...ctx })

startMessageWorker(redis, flowExecService, botRepo)

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '0.0.0.0' })
console.log(`WhatsBot backend running on port ${port}`)
