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
import { leadRoutes } from './routes/leads.js'

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

const messaging = new EvolutionAPIAdapter(
  process.env.EVOLUTION_URL!,
  process.env.EVOLUTION_API_KEY!,
  process.env.PROXY_HOST,
  process.env.PROXY_PORT,
)

const aiProviders = {
  claude: process.env.CLAUDE_API_KEY ? new ClaudeAdapter(process.env.CLAUDE_API_KEY) : null,
  groq: process.env.GROQ_API_KEY ? new GroqAdapter(process.env.GROQ_API_KEY) : null,
}

const aiService = new AIGenerationService(aiProviders)
const flowExecService = new FlowExecutionService(flowRepo, conversationRepo, leadRepo, messaging, aiService, eventRepo)
const botService = new BotService(botRepo, flowRepo, messaging)
const timeoutService = new TimeoutService(conversationRepo, botRepo, flowRepo, messaging, flowExecService, eventRepo)
timeoutService.start()

await app.register(cors, { origin: process.env.FRONTEND_URL ?? '*' })
await app.register(jwt, { secret: process.env.JWT_SECRET! })
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

const ctx = { botRepo, flowRepo, conversationRepo, leadRepo, botService, flowExecService, messaging, redis }

await app.register(authRoutes, { prefix: '/api/auth', db })
await app.register(aiRoutes, { prefix: '/api/ai', aiService })
await app.register(botRoutes, { prefix: '/api/bots', ...ctx })
await app.register(flowRoutes, { prefix: '/api/flows', ...ctx })
await app.register(conversationRoutes, { prefix: '/api/conversations', ...ctx })
await app.register(leadRoutes, { prefix: '/api/leads', ...ctx })
await app.register(webhookRoutes, { prefix: '/webhooks', ...ctx })

startMessageWorker(redis, flowExecService, botRepo)

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '0.0.0.0' })
console.log(`WhatsBot backend running on port ${port}`)
