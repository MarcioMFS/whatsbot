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
import { NvidiaNIMAdapter } from './adapters/NvidiaNIMAdapter.js'
import { BotService } from './services/BotService.js'
import { FlowExecutionService } from './services/FlowExecutionService.js'
import { AIGenerationService } from './services/AIGenerationService.js'
import { TimeoutService } from './services/TimeoutService.js'
import { startMessageWorker } from './queue/messageWorker.js'
import { PostgreSQLLeadRepository } from './adapters/PostgreSQLLeadRepository.js'
import { PostgreSQLConversationEventRepository } from './adapters/PostgreSQLConversationEventRepository.js'
import { PostgreSQLConversationOutcomeRepository } from './adapters/PostgreSQLConversationOutcomeRepository.js'
import { PostgreSQLPaymentIntentRepository } from './adapters/PostgreSQLPaymentIntentRepository.js'
import { PostgreSQLProductRepository } from './adapters/PostgreSQLProductRepository.js'
import { PostgreSQLOrderRepository } from './adapters/PostgreSQLOrderRepository.js'
import { PostgreSQLProposalRepository } from './adapters/PostgreSQLProposalRepository.js'
import { PostgreSQLFlowVersionRepository } from './adapters/PostgreSQLFlowVersionRepository.js'
import { PostgreSQLPackageOfferRepository } from './adapters/PostgreSQLPackageOfferRepository.js'
import { CatalogSearchService } from './services/CatalogSearchService.js'
import { TranscriptionService } from './services/TranscriptionService.js'
import { VisionTitleExtractor } from './services/VisionTitleExtractor.js'
import { GeminiProvider } from './agent/providers/GeminiProvider.js'
import { GroqAgentProvider } from './agent/providers/GroqAgentProvider.js'
import { SegmentGenerationService } from './services/SegmentGenerationService.js'
import { FlowGenerationService } from './services/FlowGenerationService.js'
import { ImproverService } from './services/ImproverService.js'
import { MetricsAggregator } from './services/MetricsAggregator.js'
import { PatternDistiller } from './services/PatternDistiller.js'
import { PatternPerformanceService } from './services/PatternPerformanceService.js'
import { AgentRuntime } from './agent/AgentRuntime.js'
import { ModuleRegistry } from './services/ModuleRegistry.js'
import { ContextualAIRouter } from './services/ContextualAIRouter.js'
import { PaymentPhaseRouter } from './services/PaymentPhaseRouter.js'
import { PostgreSQLAIDecisionRepository } from './adapters/PostgreSQLAIDecisionRepository.js'
import { PostgreSQLAgentTraceRepository } from './adapters/PostgreSQLAgentTraceRepository.js'
import { PostgreSQLDeliveryAuditRepository } from './adapters/PostgreSQLDeliveryAuditRepository.js'
import { PaymentOrchestrator } from './payment/PaymentOrchestrator.js'
import { ReceiptExtractorAI } from './payment/ReceiptExtractorAI.js'
import { PostgreSQLUsedTransactionRepository } from './adapters/PostgreSQLUsedTransactionRepository.js'
import { InternalEventBus } from './events/InternalEventBus.js'
import { DeliveryService } from './services/DeliveryService.js'
import { leadRoutes } from './routes/leads.js'
import { productRoutes } from './routes/products.js'
import { orderRoutes } from './routes/orders.js'
import { proposalRoutes } from './routes/proposals.js'
import { metricsRoutes } from './routes/metrics.js'
import { mcpRoutes } from './routes/mcp.js'
import { packageOfferRoutes } from './routes/packageOffers.js'
import { handoffRoutes } from './routes/handoffs.js'
import { PostgreSQLHandoffRepository } from './adapters/PostgreSQLHandoffRepository.js'
import { paymentIntentRoutes } from './routes/paymentIntents.js'
import { PostgreSQLCapabilityRepository } from './adapters/PostgreSQLCapabilityRepository.js'
import { PostgreSQLAIObservationRepository } from './adapters/PostgreSQLAIObservationRepository.js'
import { CapabilityRouter } from './services/CapabilityRouter.js'
import { PatternDetector } from './services/PatternDetector.js'
import { capabilitiesRoutes } from './routes/capabilities.js'
import { observationRoutes } from './routes/observations.js'

const requiredEnv = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'EVOLUTION_URL', 'EVOLUTION_API_KEY']
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
}

const app = Fastify({ logger: true })

const db = new Pool({ connectionString: process.env.DATABASE_URL })
const redis = new Redis(process.env.REDIS_URL!)

const botRepo = new PostgreSQLBotRepository(db)
const flowRepo = new PostgreSQLFlowRepository(db)
const proposalRepo = new PostgreSQLProposalRepository(db)
const flowVersionRepo = new PostgreSQLFlowVersionRepository(db)
const conversationRepo = new RedisConversationRepository(redis, db)
const leadRepo = new PostgreSQLLeadRepository(db)
const eventRepo = new PostgreSQLConversationEventRepository(db)
const conversationOutcomeRepo = new PostgreSQLConversationOutcomeRepository(db)
const paymentIntentRepo = new PostgreSQLPaymentIntentRepository(db)

const messaging = new EvolutionAPIAdapter(
  process.env.EVOLUTION_URL!,
  process.env.EVOLUTION_API_KEY!,
)

const groqKeys = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
  process.env.GROQ_API_KEY_6,
].filter(Boolean) as string[]

const aiProviders = {
  claude: process.env.CLAUDE_API_KEY ? new ClaudeAdapter(process.env.CLAUDE_API_KEY) : null,
  groq: groqKeys.length ? new GroqAdapter(groqKeys) : null,
  // Builder/Improver: free endpoint, NUNCA no hot-path do cliente (ver AIGenerationService.generateBuilder).
  nvidia: process.env.NVIDIA_API_KEY ? new NvidiaNIMAdapter(process.env.NVIDIA_API_KEY) : null,
}

const transcriptionService = groqKeys.length ? new TranscriptionService(groqKeys) : undefined
if (!transcriptionService) console.warn('[index] No GROQ keys — voice note transcription disabled')

const productRepo = new PostgreSQLProductRepository(db)
const orderRepo = new PostgreSQLOrderRepository(db)
const packageOfferRepo = new PostgreSQLPackageOfferRepository(db)
const handoffRepo = new PostgreSQLHandoffRepository(db)

const aiService = new AIGenerationService(aiProviders)
const agentTrace = new PostgreSQLAgentTraceRepository(db)
const aiDecisionRepo = new PostgreSQLAIDecisionRepository(db)
const observationRepo = new PostgreSQLAIObservationRepository(db)
const catalogSearchService = new CatalogSearchService(productRepo, aiService, aiDecisionRepo)
const contextualAIRouter = new ContextualAIRouter(aiService, aiDecisionRepo, observationRepo)
const paymentPhaseRouter = new PaymentPhaseRouter(aiService, aiDecisionRepo)
const usedTransactionRepo = new PostgreSQLUsedTransactionRepository(db)
const eventBus = new InternalEventBus(db)
const claudeProvider = aiProviders.claude
if (!claudeProvider) throw new Error('CLAUDE_API_KEY required for receipt validation')
const receiptExtractor = new ReceiptExtractorAI(claudeProvider)
const visionTitleExtractor = new VisionTitleExtractor(claudeProvider)
const paymentOrchestrator = new PaymentOrchestrator(receiptExtractor, paymentIntentRepo, usedTransactionRepo, eventBus)
const deliveryAuditRepo = new PostgreSQLDeliveryAuditRepository(db)
const deliveryService = new DeliveryService(messaging, eventRepo, deliveryAuditRepo)
const capabilityRepo = new PostgreSQLCapabilityRepository(db)
const capabilityRouter = new CapabilityRouter(capabilityRepo, aiService, observationRepo)
const patternDetector = new PatternDetector(db)
const improver = new ImproverService(db, patternDetector, aiService, proposalRepo)
const flowExecService = new FlowExecutionService(
  flowRepo, conversationRepo, leadRepo, messaging, aiService,
  eventRepo, paymentOrchestrator, paymentIntentRepo,
  catalogSearchService, productRepo, orderRepo, deliveryService, packageOfferRepo, handoffRepo,
  contextualAIRouter, paymentPhaseRouter, capabilityRouter, observationRepo,
  visionTitleExtractor, conversationOutcomeRepo,
)
const botService = new BotService(botRepo, flowRepo, messaging)
const segmentGen = new SegmentGenerationService(aiService)
const metricsAggregator = new MetricsAggregator(db)
const patternDistiller = new PatternDistiller(db)
const patternPerformance = new PatternPerformanceService(db)
const flowGen = new FlowGenerationService(aiService, patternDistiller) // F3: gerador consome os padrões vencedores
// Registro de Módulos — resolve liga/desliga + config por bot; alimenta tool-set do agente (F2) e efeitos (F3).
const moduleRegistry = new ModuleRegistry()
console.log(`[ModuleRegistry] ${moduleRegistry.definitions().length} módulos: ${moduleRegistry.definitions().map(m => m.id).join(', ')}`)

const timeoutService = new TimeoutService(conversationRepo, botRepo, flowRepo, messaging, flowExecService, leadRepo, eventRepo, moduleRegistry, conversationOutcomeRepo)
timeoutService.start()

// F1 — materializa o funnel_metrics no boot e de hora em hora (read-only, fora do hot-path).
metricsAggregator.refresh().then(r => console.log(`[MetricsAggregator] funnel_metrics refreshed: ${r.scopes} escopos`)).catch(e => console.error('[MetricsAggregator] refresh inicial falhou:', e?.message))
setInterval(() => { metricsAggregator.refresh().catch(e => console.error('[MetricsAggregator] refresh falhou:', e?.message)) }, 60 * 60_000)

// F2 — semeia o store de padrões vencedores com o playbook (idempotente) no boot.
patternDistiller.seed().then(r => console.log(`[PatternDistiller] winning_patterns seeded: ${r.seeded} do playbook`)).catch(e => console.error('[PatternDistiller] seed falhou:', e?.message))

// F4 — re-avalia padrões (promover/aposentar por dado) 1x/dia. Dormente até haver candidates + volume.
setInterval(() => { patternPerformance.run().then(r => { if (r.evaluated > 0) console.log(`[PatternPerformance] ${r.note}`) }).catch(e => console.error('[PatternPerformance] run falhou:', e?.message)) }, 24 * 60 * 60_000)

// #sec: nunca '*' num backend financeiro. FRONTEND_URL está setada em prod; fallback = false (fail-safe).
await app.register(cors, { origin: process.env.FRONTEND_URL ?? false })
await app.register(jwt, { secret: process.env.JWT_SECRET! })
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

const ctx = { botRepo, flowRepo, conversationRepo, leadRepo, botService, flowExecService, messaging, redis, eventRepo, agentTrace }

await app.register(authRoutes, { prefix: '/api/auth', db })
await app.register(aiRoutes, { prefix: '/api/ai', aiService })
await app.register(botRoutes, { prefix: '/api/bots', ...ctx })
await app.register(flowRoutes, { prefix: '/api/flows', ...ctx, segmentGen })
await app.register(conversationRoutes, { prefix: '/api/conversations', ...ctx })
await app.register(leadRoutes, { prefix: '/api/leads', ...ctx })
await app.register(productRoutes, { prefix: '/api/products', productRepo, botRepo })
await app.register(orderRoutes, { prefix: '/api/orders', orderRepo, botRepo })
await app.register(packageOfferRoutes, { prefix: '/api/package-offers', packageOfferRepo, botRepo })
await app.register(handoffRoutes, { prefix: '/api/handoffs', handoffRepo, convRepo: conversationRepo, botRepo, messaging })
await app.register(paymentIntentRoutes, { prefix: '/api/payment-intents', paymentIntentRepo, botRepo })
await app.register(capabilitiesRoutes, { prefix: '/api/capabilities', capabilityRepo, capabilityRouter, patternDetector, botRepo })
await app.register(observationRoutes, { prefix: '/api/observations', observationRepo, botRepo })
await app.register(proposalRoutes, { prefix: '/api/proposals', proposalRepo, flowVersionRepo, flowRepo, botRepo, segmentGen, flowGen, improver, db })
await app.register(metricsRoutes, { prefix: '/api/metrics', aggregator: metricsAggregator, distiller: patternDistiller, performance: patternPerformance, botRepo })
await app.register(mcpRoutes, { prefix: '/mcp', db, botRepo, conversationRepo, leadRepo, messaging })
await app.register(webhookRoutes, { prefix: '/webhooks', ...ctx })

// v2 — Agent runtime (tool-calling). Ativado por bot.globalConfig.runtime === 'agent'.
// Provider do agente: Groq (default, llama-3.3-70b) ou Gemini (AGENT_PROVIDER=gemini).
// Gemini exige projeto GCP com billing ativo; Groq é o fallback enquanto isso.
const agentProvider = process.env.AGENT_PROVIDER === 'gemini'
  ? new GeminiProvider()
  : new GroqAgentProvider(groqKeys)
const agentRuntime = new AgentRuntime(
  agentProvider,
  conversationRepo,
  leadRepo,
  messaging,
  { catalogSearchService, productRepo, paymentIntentRepo, packageOfferRepo, paymentOrchestrator, orderRepo },
  moduleRegistry,
  agentTrace,
)

startMessageWorker(redis, flowExecService, botRepo, transcriptionService, agentRuntime)

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '0.0.0.0' })
console.log(`WhatsBot backend running on port ${port}`)
