/**
 * Automated test: payment_confirmed → post-purchase recovery
 *
 * Scenario:
 * 1. User enters flow, receives PIX
 * 2. payment_confirmed node fires
 * 3. User sends "okay"
 * 4. Expected: inline ack response, no new flow started
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Conversation,
  Lead,
  Flow,
  Bot,
  type ConversationRepository,
  type LeadRepository,
  type FlowRepository,
  type MessagingPort,
  type ConversationEventRepository,
  type ConversationEvent,
} from '@whatsbot/core'
import { FlowExecutionService } from '../services/FlowExecutionService.js'

// ─── In-memory stubs ──────────────────────────────────────────────────────────

class InMemConversationRepo implements ConversationRepository {
  private store = new Map<string, Conversation>()
  async findActiveByPhone(botId: string, phone: string) {
    return this.store.get(`${botId}:${phone}`) ?? null
  }
  async findById(id: string) { return null }
  async findByBotId(botId: string) { return [] }
  async save(conv: Conversation) {
    if (conv.status === 'ended') {
      this.store.delete(`${conv.botId}:${conv.phoneNumber}`)
    } else {
      this.store.set(`${conv.botId}:${conv.phoneNumber}`, conv)
    }
  }
}

class InMemLeadRepo implements LeadRepository {
  private store = new Map<string, Lead>()
  async findByPhone(botId: string, phone: string) {
    return this.store.get(`${botId}:${phone}`) ?? null
  }
  async findByBotId() { return [] }
  async findByTag() { return [] }
  async countByBotId() { return 0 }
  async save(lead: Lead) {
    this.store.set(`${lead.botId}:${lead.phoneNumber}`, lead)
  }
}

class InMemFlowRepo implements FlowRepository {
  constructor(private flows: Flow[]) {}
  async findById(id: string) { return this.flows.find(f => f.id === id) ?? null }
  async findByBotId() { return this.flows }
  async save() {}
  async delete() {}
}

class InMemMessaging implements MessagingPort {
  sent: Array<{ phoneNumber: string; message: string }> = []
  async sendMessage(p: { phoneNumber: string; message: string }) {
    this.sent.push(p)
  }
}

class InMemEventRepo implements ConversationEventRepository {
  emitted: ConversationEvent[] = []
  async emit(e: ConversationEvent) { this.emitted.push(e) }
  async findByBot() { return [] }
  async findByPhone() { return [] }
  async countByType() { return 0 }
}

// ─── Helper: build minimal bot ───────────────────────────────────────────────

function makeBot(activeFlowId: string): Bot {
  return Bot.reconstitute({
    id: 'bot-001',
    name: 'TestBot',
    productInfo: { name: 'Produto', description: '', persona: '', language: 'pt-BR' },
    aiConfig: { provider: 'groq', model: 'llama3', temperature: 0.7, maxTokens: 500, systemPromptTemplate: '' },
    evolutionConfig: { instanceName: 'test-instance' },
    activeFlowId,
    routingRules: [],
    isActive: true,
    webhookSecret: 'secret',
    ownerId: 'user-001',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

// ─── Helper: build test flow ─────────────────────────────────────────────────
// trigger → pix → payment_confirmed → end

function makeSaleFlow(): Flow {
  const triggerId = 'node-trigger'
  const pixId = 'node-pix'
  const pcId = 'node-payment-confirmed'
  const endId = 'node-end'

  return Flow.reconstitute({
    id: 'flow-sale',
    botId: 'bot-001',
    name: 'Sale Flow',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: [
      { id: triggerId, type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'any_message' } },
      { id: pixId, type: 'pix', position: { x: 0, y: 100 }, data: { label: 'Pix', pixKey: '11999999999' } },
      { id: pcId, type: 'payment_confirmed', position: { x: 0, y: 200 }, data: {
        label: 'Payment OK',
        confirmationMessage: 'Pagamento confirmado! 🎉 Obrigado pela sua compra.',
        postPurchaseMessage: 'Em breve você receberá mais informações. Qualquer dúvida, é só chamar! 😊',
      }},
      { id: endId, type: 'end', position: { x: 0, y: 300 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: triggerId, target: pixId },
      { id: 'e2', source: pixId, target: pcId },
      { id: 'e3', source: pcId, target: endId },
    ],
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('payment_confirmed sets buyer tag and lastPaymentConfirmedAt', async () => {
  const saleFlow = makeSaleFlow()
  const bot = makeBot(saleFlow.id)

  const convRepo = new InMemConversationRepo()
  const leadRepo = new InMemLeadRepo()
  const flowRepo = new InMemFlowRepo([saleFlow])
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()
  const aiService = { generate: async () => ({ content: 'ok', tokensUsed: 0 }) } as any

  const service = new FlowExecutionService(flowRepo, convRepo, leadRepo, messaging, aiService, eventRepo)

  // First message — triggers flow, runs through pix → payment_confirmed → end
  await service.handleIncomingMessage(bot, '5511999999999', 'oi')

  const lead = await leadRepo.findByPhone('bot-001', '5511999999999')
  assert.ok(lead, 'lead should be created')
  assert.ok(lead!.tags.includes('buyer'), 'lead should have buyer tag')
  assert.ok(lead!.tags.includes('sent_pix'), 'lead should have sent_pix tag')
  assert.ok(lead!.lastPaymentConfirmedAt !== null, 'lastPaymentConfirmedAt should be set')
  assert.ok(lead!.isRecentBuyer(), 'lead should be recognized as recent buyer')

  // Confirmation messages should have been sent
  const msgs = messaging.sent.map(m => m.message)
  assert.ok(msgs.some(m => m.includes('Pagamento confirmado')), 'confirmation message should be sent')
  assert.ok(msgs.some(m => m.includes('Em breve')), 'post-purchase message should be sent')
})

test('after payment_confirmed, "okay" does NOT restart sale flow', async () => {
  const saleFlow = makeSaleFlow()
  const bot = makeBot(saleFlow.id)

  const convRepo = new InMemConversationRepo()
  const leadRepo = new InMemLeadRepo()
  const flowRepo = new InMemFlowRepo([saleFlow])
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()
  const aiService = { generate: async () => ({ content: 'ok', tokensUsed: 0 }) } as any

  const service = new FlowExecutionService(flowRepo, convRepo, leadRepo, messaging, aiService, eventRepo)

  // Step 1: user enters flow → payment_confirmed fires → conversation ends
  await service.handleIncomingMessage(bot, '5511999999999', 'quero comprar')

  // Verify buyer state
  const leadAfterPurchase = await leadRepo.findByPhone('bot-001', '5511999999999')
  assert.ok(leadAfterPurchase!.isRecentBuyer(), 'should be recent buyer after flow')

  // Step 2: user sends acknowledgment — should NOT restart sale flow
  messaging.sent = [] // reset sent messages
  await service.handleIncomingMessage(bot, '5511999999999', 'okay')

  // Flow should NOT have restarted — no pix message should be sent
  const pixSent = messaging.sent.some(m => m.message.includes('Chave Pix'))
  assert.ok(!pixSent, 'sale flow should NOT restart — pix should not be sent again')

  // Inline ack response should be sent
  const ackSent = messaging.sent.some(m => m.message.includes('Às ordens'))
  assert.ok(ackSent, 'inline ack response should be sent')

  // post_purchase_support_started event should be emitted
  const ppEvent = eventRepo.emitted.find(e => e.eventType === 'post_purchase_support_started')
  assert.ok(ppEvent, 'post_purchase_support_started event should be emitted')
  assert.equal((ppEvent!.payload as any).inline, true)
})

test('buyer with dedicated support flow gets routed, not blocked', async () => {
  const saleFlow = makeSaleFlow()
  const supportFlow = Flow.reconstitute({
    id: 'flow-support',
    botId: 'bot-001',
    name: 'Support Flow',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: [
      { id: 'sup-trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'any_message' } },
      { id: 'sup-text', type: 'text_message', position: { x: 0, y: 100 }, data: { label: 'Support', message: 'Olá! Como posso ajudar com seu pedido?' } },
      { id: 'sup-end', type: 'end', position: { x: 0, y: 200 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'se1', source: 'sup-trigger', target: 'sup-text' },
      { id: 'se2', source: 'sup-text', target: 'sup-end' },
    ],
  })

  // Bot with routing rule: buyer → support flow
  const bot = Bot.reconstitute({
    id: 'bot-001',
    name: 'TestBot',
    productInfo: { name: 'Produto', description: '', persona: '', language: 'pt-BR' },
    aiConfig: { provider: 'groq', model: 'llama3', temperature: 0.7, maxTokens: 500, systemPromptTemplate: '' },
    evolutionConfig: { instanceName: 'test-instance' },
    activeFlowId: saleFlow.id,
    routingRules: [{ tag: 'buyer', flowId: supportFlow.id }],
    isActive: true,
    webhookSecret: 'secret',
    ownerId: 'user-001',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const convRepo = new InMemConversationRepo()
  const leadRepo = new InMemLeadRepo()
  const flowRepo = new InMemFlowRepo([saleFlow, supportFlow])
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()
  const aiService = { generate: async () => ({ content: 'ok', tokensUsed: 0 }) } as any

  const service = new FlowExecutionService(flowRepo, convRepo, leadRepo, messaging, aiService, eventRepo)

  // Step 1: complete purchase
  await service.handleIncomingMessage(bot, '5511999999999', 'oi')
  messaging.sent = []

  // Step 2: user sends ANY message → should go to support flow, not sale flow
  await service.handleIncomingMessage(bot, '5511999999999', 'onde está meu produto?')

  const supportSent = messaging.sent.some(m => m.message.includes('Como posso ajudar com seu pedido'))
  assert.ok(supportSent, 'support flow should have responded')

  const pixSent = messaging.sent.some(m => m.message.includes('Chave Pix'))
  assert.ok(!pixSent, 'sale flow should NOT have been triggered')
})
