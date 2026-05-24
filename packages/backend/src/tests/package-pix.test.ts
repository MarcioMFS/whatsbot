import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Bot, Flow, Conversation, Lead,
  PackageOffer, PaymentIntent,
  type ConversationRepository, type LeadRepository,
  type FlowRepository, type MessagingPort,
  type ConversationEventRepository, type ConversationEvent,
  type PaymentIntentRepository, type PackageOfferRepository,
} from '@whatsbot/core'
import { FlowExecutionService } from '../services/FlowExecutionService.js'

// ─── In-memory stubs ──────────────────────────────────────────────────────────

class InMemConversationRepo implements ConversationRepository {
  store = new Map<string, Conversation>()
  byId = new Map<string, Conversation>()
  async findActiveByPhone(botId: string, phone: string) { return this.store.get(`${botId}:${phone}`) ?? null }
  async findById(id: string) { return this.byId.get(id) ?? null }
  async findByBotId() { return [] }
  async save(conv: Conversation) {
    this.byId.set(conv.id, conv)
    if (conv.status !== 'ended') this.store.set(`${conv.botId}:${conv.phoneNumber}`, conv)
    else this.store.delete(`${conv.botId}:${conv.phoneNumber}`)
  }
}

class InMemLeadRepo implements LeadRepository {
  store = new Map<string, Lead>()
  async findByPhone(botId: string, phone: string) { return this.store.get(`${botId}:${phone}`) ?? null }
  async findByBotId() { return [] }
  async findByTag() { return [] }
  async countByBotId() { return 0 }
  async save(lead: Lead) { this.store.set(`${lead.botId}:${lead.phoneNumber}`, lead) }
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
  async sendMessage(p: { phoneNumber: string; message: string }) { this.sent.push(p) }
  async getInstanceStatus() { return { instanceName: 'test', state: 'open' as const } }
  async createInstance() { return { qrCode: '' } }
  async deleteInstance() {}
  async setWebhook() {}
  async connectInstance() { return { qrCode: '' } }
}

class InMemEventRepo implements ConversationEventRepository {
  emitted: ConversationEvent[] = []
  async emit(e: ConversationEvent) { this.emitted.push(e) }
  async findByBot() { return [] }
  async findByPhone() { return [] }
  async countByType() { return 0 }
}

class InMemPaymentIntentRepo implements PaymentIntentRepository {
  intents: PaymentIntent[] = []
  async findById(id: string) { return this.intents.find(i => i.id === id) ?? null }
  async findPendingByConversation(conversationId: string) {
    return this.intents.find(i => i.conversationId === conversationId && i.status === 'pending') ?? null
  }
  async findByLead() { return [] }
  async save(intent: PaymentIntent) {
    const idx = this.intents.findIndex(i => i.id === intent.id)
    if (idx >= 0) this.intents[idx] = intent
    else this.intents.push(intent)
  }
}

class InMemPackageOfferRepo implements PackageOfferRepository {
  constructor(public offers: PackageOffer[]) {}
  async findById(id: string) { return this.offers.find(o => o.id === id) ?? null }
  async findByBotId(botId: string, includeInactive = false) {
    return this.offers.filter(o => o.botId === botId && (includeInactive || o.isActive))
  }
  async save(offer: PackageOffer) {
    const idx = this.offers.findIndex(o => o.id === offer.id)
    if (idx >= 0) this.offers[idx] = offer
    else this.offers.push(offer)
  }
  async delete(id: string) { this.offers = this.offers.filter(o => o.id !== id) }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBot() {
  return Bot.reconstitute({
    id: 'bot-001', name: 'DramaHub',
    productInfo: { name: 'DramaHub', description: '', persona: '', language: 'pt-BR' },
    aiConfig: { provider: 'groq', model: 'llama3', temperature: 0.7, maxTokens: 500, systemPromptTemplate: '' },
    evolutionConfig: { instanceName: 'test-instance' },
    activeFlowId: 'flow-pkgpix',
    routingRules: [],
    isActive: true,
    webhookSecret: 'secret',
    ownerId: 'user-001',
    globalConfig: { defaultPixKey: 'dramahub@mfslabs.com.br', defaultReceiverName: 'DramaHub' },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

function makeDramaHubOffers(): PackageOffer[] {
  const specs: [number, number][] = [
    [1, 600], [2, 1000], [3, 1300], [5, 2000], [10, 3000], [24, 5500], [35, 7500],
  ]
  return specs.map(([qty, price]) =>
    PackageOffer.create({
      botId: 'bot-001',
      name: `${qty} série(s)`,
      type: 'quantity_bundle',
      pricingMode: 'minimum_quantity',
      quantity: qty,
      priceCentavos: price,
    })
  )
}

function makeFlow(quantityVariable = 'qty_pedida') {
  return Flow.reconstitute({
    id: 'flow-pkgpix', botId: 'bot-001', name: 'PackagePix Flow',
    isDefault: true, createdAt: new Date(), updatedAt: new Date(),
    nodes: [
      { id: 'n-trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'any_message' } },
      { id: 'n-pkgpix', type: 'package_pix', position: { x: 0, y: 100 }, data: {
        label: 'Package Pix',
        quantityVariable,
        unitPriceCentavos: 600,
        outputVariable: 'paymentIntentId',
      }},
      { id: 'n-end-ok', type: 'end', position: { x: 0, y: 200 }, data: { label: 'OK' } },
      { id: 'n-end-err', type: 'end', position: { x: 200, y: 200 }, data: { label: 'ERR' } },
    ],
    edges: [
      { id: 'e1', source: 'n-trigger', target: 'n-pkgpix' },
      { id: 'e2', source: 'n-pkgpix', sourceHandle: 'success', target: 'n-end-ok' },
      { id: 'e3', source: 'n-pkgpix', sourceHandle: 'error', target: 'n-end-err' },
    ],
  })
}

async function runPackagePix(qtyInput: string, offers: PackageOffer[], phone = '5511900000001') {
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()
  const paymentIntentRepo = new InMemPaymentIntentRepo()
  const offerRepo = new InMemPackageOfferRepo(offers)
  const convRepo = new InMemConversationRepo()
  const bot = makeBot()
  const flow = makeFlow()
  const aiService = { generate: async () => ({ content: '{}', inputTokens: 0, outputTokens: 0 }) } as any

  const svc = new FlowExecutionService(
    new InMemFlowRepo([flow]),
    convRepo,
    new InMemLeadRepo(),
    messaging,
    aiService,
    eventRepo,
    undefined,       // redis
    paymentIntentRepo,
    undefined,       // catalogSearchService
    undefined,       // productRepo
    undefined,       // orderRepo
    undefined,       // deliveryService
    offerRepo,
  )

  // Pre-seed conversation at n-pkgpix with the quantity variable already set
  const conv = Conversation.create({ botId: bot.id, flowId: flow.id, phoneNumber: phone, triggerNodeId: 'n-trigger' })
  conv.setVariable('qty_pedida', qtyInput)
  conv.moveToNode('n-pkgpix')
  convRepo.store.set(`${bot.id}:${phone}`, conv)
  convRepo.byId.set(conv.id, conv)

  await svc.handleIncomingMessage(bot, phone, qtyInput)

  const saved = convRepo.byId.get(conv.id) ?? conv
  return { conv: saved, messaging, paymentIntentRepo, eventRepo }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('1. quantity "2" applies R$10 package offer', async () => {
  const { conv, paymentIntentRepo, messaging } = await runPackagePix('2', makeDramaHubOffers())

  assert.equal(paymentIntentRepo.intents.length, 1)
  assert.equal(paymentIntentRepo.intents[0].amount, 1000)
  assert.equal(conv.variables['__rt_checkout_final_total'], '1000')
  assert.equal(conv.variables['__rt_package_quantity'], '2')
  assert.ok(messaging.sent.some(m => m.message.includes('R$ 10,00')), 'Pix message sent with R$10')
})

test('2. quantity "quero 3" applies R$13 package offer', async () => {
  const { conv, paymentIntentRepo } = await runPackagePix('quero 3', makeDramaHubOffers(), '5511900000002')

  assert.equal(paymentIntentRepo.intents.length, 1)
  assert.equal(paymentIntentRepo.intents[0].amount, 1300)
  assert.equal(conv.variables['__rt_package_quantity'], '3')
})

test('3. invalid quantity returns error handle and sets error variable', async () => {
  const { conv, paymentIntentRepo } = await runPackagePix('não sei', makeDramaHubOffers(), '5511900000003')

  assert.equal(paymentIntentRepo.intents.length, 0)
  assert.ok(conv.variables['__rt_package_pix_error'], 'error variable set')
})

test('4. creates exactly 1 PaymentIntent per call', async () => {
  const { paymentIntentRepo } = await runPackagePix('5', makeDramaHubOffers(), '5511900000004')
  assert.equal(paymentIntentRepo.intents.length, 1)
})

test('5. PaymentIntent amount equals PricingService final total', async () => {
  const { conv, paymentIntentRepo } = await runPackagePix('5', makeDramaHubOffers(), '5511900000005')

  const intent = paymentIntentRepo.intents[0]
  const finalTotal = parseInt(conv.variables['__rt_checkout_final_total'], 10)
  assert.equal(intent.amount, finalTotal)
  assert.equal(intent.amount, 2000) // 5 series = R$20
})

test('6. package_pix does not interfere with independent instance', async () => {
  const offers = makeDramaHubOffers()
  // Two independent calls on different phones/repos
  const { paymentIntentRepo: repo1 } = await runPackagePix('3', offers, '5511900000006')
  const { paymentIntentRepo: repo2 } = await runPackagePix('10', offers, '5511900000007')

  assert.equal(repo1.intents.length, 1)
  assert.equal(repo1.intents[0].amount, 1300) // 3 series = R$13
  assert.equal(repo2.intents.length, 1)
  assert.equal(repo2.intents[0].amount, 3000) // 10 series = R$30
})
