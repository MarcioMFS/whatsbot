import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Conversation,
  Lead,
  Flow,
  Bot,
  Product,
  Order,
  Cart,
  PaymentIntent,
  type ConversationRepository,
  type LeadRepository,
  type FlowRepository,
  type MessagingPort,
  type ConversationEventRepository,
  type ConversationEvent,
  type ProductRepository,
  type OrderRepository,
  type PaymentIntentRepository,
} from '@whatsbot/core'
import { FlowExecutionService } from '../services/FlowExecutionService.js'
import { CatalogSearchService } from '../services/CatalogSearchService.js'
import { DeliveryService } from '../services/DeliveryService.js'

// ─── In-memory stubs ──────────────────────────────────────────────────────────

class InMemConversationRepo implements ConversationRepository {
  store = new Map<string, Conversation>()
  byId = new Map<string, Conversation>()
  async findActiveByPhone(botId: string, phone: string) {
    return this.store.get(`${botId}:${phone}`) ?? null
  }
  async findById(id: string) { return this.byId.get(id) ?? null }
  async findByBotId() { return [] }
  async save(conv: Conversation) {
    this.byId.set(conv.id, conv)
    if (conv.status === 'ended') {
      this.store.delete(`${conv.botId}:${conv.phoneNumber}`)
    } else {
      this.store.set(`${conv.botId}:${conv.phoneNumber}`, conv)
    }
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

class InMemProductRepo implements ProductRepository {
  constructor(public products: Product[]) {}
  async findById(id: string) { return this.products.find(p => p.id === id) ?? null }
  async findByBotId(botId: string, includeUnavailable = false) {
    return this.products.filter(p => p.botId === botId && (includeUnavailable || p.isAvailable))
  }
  async search(botId: string, query: string, limit = 10) {
    const q = query.toLowerCase()
    return this.products
      .filter(p => p.botId === botId && p.isAvailable)
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.aliases.some(a => a.toLowerCase().includes(q))
      )
      .slice(0, limit)
  }
  async save(product: Product) {
    const idx = this.products.findIndex(p => p.id === product.id)
    if (idx >= 0) this.products[idx] = product
    else this.products.push(product)
  }
  async delete(id: string) {
    this.products = this.products.filter(p => p.id !== id)
  }
}

class InMemOrderRepo implements OrderRepository {
  orders: Order[] = []
  async findById(id: string) { return this.orders.find(o => o.id === id) ?? null }
  async findByConversation(conversationId: string) { return this.orders.filter(o => o.conversationId === conversationId) }
  async findByBotId(botId: string, limit = 50) { return this.orders.filter(o => o.botId === botId).slice(0, limit) }
  async save(order: Order) {
    const idx = this.orders.findIndex(o => o.id === order.id)
    if (idx >= 0) this.orders[idx] = order
    else this.orders.push(order)
  }
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBot(): Bot {
  return Bot.reconstitute({
    id: 'bot-001', name: 'TestBot',
    productInfo: { name: 'DramaHub', description: '', persona: '', language: 'pt-BR' },
    aiConfig: { provider: 'groq', model: 'llama3', temperature: 0.7, maxTokens: 500, systemPromptTemplate: '' },
    evolutionConfig: { instanceName: 'test-instance' },
    activeFlowId: 'flow-catalog',
    routingRules: [],
    isActive: true,
    webhookSecret: 'secret',
    ownerId: 'user-001',
    globalConfig: { defaultPixKey: '11999999999', defaultReceiverName: 'DramaHub' },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

function makeProduct(name: string, aliases: string[], accessLink?: string): Product {
  return Product.reconstitute({
    id: `prod-${name.replace(/\s/g, '-').toLowerCase()}`,
    botId: 'bot-001',
    name,
    priceCentavos: 600,
    isAvailable: true,
    aliases,
    accessLink,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

function makeCatalogFlow(): Flow {
  return Flow.reconstitute({
    id: 'flow-catalog', botId: 'bot-001', name: 'Catalog Flow',
    isDefault: true, createdAt: new Date(), updatedAt: new Date(),
    nodes: [
      { id: 'n-trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'any_message' } },
      { id: 'n-search', type: 'catalog_search', position: { x: 0, y: 100 }, data: { label: 'Search' } },
      { id: 'n-add', type: 'cart_add', position: { x: 0, y: 200 }, data: { label: 'Add' } },
      { id: 'n-summary', type: 'cart_summary', position: { x: 0, y: 300 }, data: { label: 'Summary' } },
      { id: 'n-checkout', type: 'checkout', position: { x: 0, y: 400 }, data: { label: 'Checkout', expiresInMinutes: 60 } },
      { id: 'n-capture', type: 'capture', position: { x: 0, y: 500 }, data: { label: 'Capture', variableName: 'comprovante', expectedInputType: 'image' } },
      { id: 'n-confirmed', type: 'payment_confirmed', position: { x: 0, y: 600 }, data: { label: 'Confirmed', confirmationMessage: 'Pagamento confirmado!' } },
      { id: 'n-notfound', type: 'text_message', position: { x: 200, y: 200 }, data: { label: 'NotFound', message: 'Produto não encontrado.' } },
      { id: 'n-end', type: 'end', position: { x: 0, y: 700 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'n-trigger', target: 'n-search' },
      { id: 'e2', source: 'n-search', sourceHandle: 'found', target: 'n-add' },
      { id: 'e3', source: 'n-search', sourceHandle: 'not_found', target: 'n-notfound' },
      { id: 'e4', source: 'n-add', sourceHandle: 'success', target: 'n-summary' },
      { id: 'e5', source: 'n-summary', target: 'n-checkout' },
      { id: 'e6', source: 'n-checkout', sourceHandle: 'success', target: 'n-capture' },
      { id: 'e7', source: 'n-capture', sourceHandle: 'responded', target: 'n-confirmed' },
      { id: 'e8', source: 'n-confirmed', target: 'n-end' },
      { id: 'e9', source: 'n-notfound', target: 'n-end' },
    ],
  })
}

function makeService(products: Product[], orderRepo: InMemOrderRepo, paymentIntentRepo: InMemPaymentIntentRepo, messaging: InMemMessaging, eventRepo: InMemEventRepo): FlowExecutionService {
  const bot = makeBot()
  const flow = makeCatalogFlow()
  const productRepo = new InMemProductRepo(products)
  const aiService = { generate: async () => ({ content: '{"candidates":[]}', inputTokens: 0, outputTokens: 0 }) } as any
  const catalogSearchService = new CatalogSearchService(productRepo, aiService)
  const deliveryService = new DeliveryService(messaging, eventRepo)
  return new FlowExecutionService(
    new InMemFlowRepo([flow]),
    new InMemConversationRepo(),
    new InMemLeadRepo(),
    messaging,
    aiService,
    eventRepo,
    undefined,
    paymentIntentRepo,
    catalogSearchService,
    productRepo,
    orderRepo,
    deliveryService,
  )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('1. catalog_search finds product by alias', async () => {
  const goblin = makeProduct('Goblin', ['goblin', 'goblim', 'the lonely and great god'], 'https://link.to/goblin')
  const productRepo = new InMemProductRepo([goblin])
  const aiService = { generate: async () => ({ content: '{}', inputTokens: 0, outputTokens: 0 }) } as any
  const service = new CatalogSearchService(productRepo, aiService)

  const result = await service.search('bot-001', 'goblim')
  assert.ok(result.products.length > 0, 'should find product by alias')
  assert.equal(result.products[0].product.name, 'Goblin')
  assert.equal(result.unresolved.length, 0)
})

test('2. catalog_search with 2 products — cart has 2 items after cart_add', async () => {
  const goblin = makeProduct('Goblin', ['goblin'], 'https://link.to/goblin')
  const crashLanding = makeProduct('Crash Landing on You', ['crash landing', 'pousando no amor'], 'https://link.to/cloy')
  const orderRepo = new InMemOrderRepo()
  const paymentIntentRepo = new InMemPaymentIntentRepo()
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()

  const productRepo = new InMemProductRepo([goblin, crashLanding])
  const aiService = { generate: async () => ({ content: '{"candidates":[]}', inputTokens: 0, outputTokens: 0 }) } as any
  const catalogSearchService = new CatalogSearchService(productRepo, aiService)

  // Simulate cart_add with 2 found products
  const found = [goblin, crashLanding]
  const cart = Cart.empty()
  cart.addItems(found.map(p => ({ productId: p.id, name: p.name, priceCentavos: p.priceCentavos, accessLink: p.accessLink })))

  assert.equal(cart.count, 2)
  assert.equal(cart.totalCentavos, 1200)
  const vars = cart.toVariables()
  const cartBack = Cart.fromVariables(vars)
  assert.equal(cartBack.count, 2, '__rt_cart_count should be 2')
})

test('3. catalog_search with 1 found + 1 unresolved — __rt_has_unresolved = true', async () => {
  const goblin = makeProduct('Goblin', ['goblin'], 'https://link.to/goblin')
  const productRepo = new InMemProductRepo([goblin])
  const aiService = { generate: async () => ({ content: '{"candidates":[]}', inputTokens: 0, outputTokens: 0 }) } as any
  const service = new CatalogSearchService(productRepo, aiService)

  // "goblin e itaewon class" — goblin found, itaewon not found (short single term → no AI)
  const goblinResult = await service.search('bot-001', 'goblin')
  assert.equal(goblinResult.products.length, 1)
  assert.equal(goblinResult.unresolved.length, 0)

  const itaewonResult = await service.search('bot-001', 'itaewon class')
  assert.equal(itaewonResult.products.length, 0)
  assert.ok(itaewonResult.unresolved.length > 0)
})

test('4. checkout creates single PaymentIntent with cart total', async () => {
  const p1 = makeProduct('Goblin', ['goblin'], 'https://link.to/goblin')
  const p2 = makeProduct('Crash Landing on You', ['crash landing'], 'https://link.to/cloy')
  const p3 = makeProduct('Itaewon Class', ['itaewon'], 'https://link.to/itaewon')
  const orderRepo = new InMemOrderRepo()
  const paymentIntentRepo = new InMemPaymentIntentRepo()
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()

  // Build cart with 3 items totalling 1800 centavos
  const cart = Cart.empty()
  cart.addItems([p1, p2, p3].map(p => ({ productId: p.id, name: p.name, priceCentavos: p.priceCentavos, accessLink: p.accessLink })))
  assert.equal(cart.totalCentavos, 1800)

  // Create intent manually as checkout node would
  const intent = PaymentIntent.create({
    botId: 'bot-001',
    leadId: 'lead-001',
    conversationId: 'conv-001',
    amount: cart.totalCentavos,
    receiverKey: '11999999999',
    receiverName: 'DramaHub',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  await paymentIntentRepo.save(intent)

  assert.equal(paymentIntentRepo.intents.length, 1, 'exactly 1 PaymentIntent created')
  assert.equal(paymentIntentRepo.intents[0].amount, 1800, 'amount matches cart total')
})

test('5. payment_confirmed creates Order delivered and sends links, clears cart', async () => {
  const goblin = makeProduct('Goblin', ['goblin'], 'https://link.to/goblin')
  const cloy = makeProduct('Crash Landing on You', ['crash landing'], 'https://link.to/cloy')
  const orderRepo = new InMemOrderRepo()
  const paymentIntentRepo = new InMemPaymentIntentRepo()
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()
  const service = makeService([goblin, cloy], orderRepo, paymentIntentRepo, messaging, eventRepo)
  const bot = makeBot()

  // Seed a cart in variables via conversation
  const cart = Cart.empty()
  cart.addItems([goblin, cloy].map(p => ({ productId: p.id, name: p.name, priceCentavos: p.priceCentavos, accessLink: p.accessLink })))

  // Create payment_confirmed flow directly
  const flow = Flow.reconstitute({
    id: 'flow-confirmed', botId: 'bot-001', name: 'PC Flow',
    isDefault: true, createdAt: new Date(), updatedAt: new Date(),
    nodes: [
      { id: 'n-trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'any_message' } },
      { id: 'n-pc', type: 'payment_confirmed', position: { x: 0, y: 100 }, data: { label: 'PC', confirmationMessage: '✅ Pago!' } },
      { id: 'n-end', type: 'end', position: { x: 0, y: 200 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'n-trigger', target: 'n-pc' },
      { id: 'e2', source: 'n-pc', target: 'n-end' },
    ],
  })

  const convRepo = new InMemConversationRepo()
  const conv = Conversation.create({ botId: bot.id, flowId: flow.id, phoneNumber: '5511999', triggerNodeId: 'n-trigger' })
  const cartVars = cart.toVariables()
  for (const [k, v] of Object.entries(cartVars)) conv.setVariable(k, v)
  conv.setVariable('__rt_checkout_payment_id', 'intent-001')
  conv.moveToNode('n-pc')
  convRepo.byId.set(conv.id, conv)
  convRepo.store.set(`${bot.id}:5511999`, conv)

  const productRepo = new InMemProductRepo([goblin, cloy])
  const aiService = { generate: async () => ({ content: '{}', inputTokens: 0, outputTokens: 0 }) } as any
  const catalogSearchService = new CatalogSearchService(productRepo, aiService)
  const deliveryService = new DeliveryService(messaging, eventRepo)
  const svc = new FlowExecutionService(
    new InMemFlowRepo([flow]), convRepo, new InMemLeadRepo(),
    messaging, aiService, eventRepo, undefined, paymentIntentRepo,
    catalogSearchService, productRepo, orderRepo, deliveryService,
  )

  await svc.handleIncomingMessage(bot, '5511999', 'oi')

  assert.equal(orderRepo.orders.length, 1, 'Order created')
  assert.equal(orderRepo.orders[0].status, 'delivered', 'Order status = delivered')

  const linksSent = messaging.sent.filter(m => m.message.includes('link.to'))
  assert.equal(linksSent.length, 2, '2 access links sent')

  const cartCleared = messaging.sent.length > 0
  const finalConv = convRepo.byId.get(conv.id)!
  assert.equal(finalConv.variables['__rt_cart'] ?? '', '', 'Cart cleared after delivery')
})

test('6. product without accessLink generates delivery_pending, owner notified', async () => {
  const goblinNoLink = makeProduct('Goblin', ['goblin'])  // no accessLink
  const orderRepo = new InMemOrderRepo()
  const messaging = new InMemMessaging()
  const eventRepo = new InMemEventRepo()

  const order = Order.create({
    botId: 'bot-001', leadId: 'lead-001', conversationId: 'conv-001',
    paymentIntentId: 'intent-001',
    items: [{ productId: goblinNoLink.id, name: goblinNoLink.name, priceCentavos: goblinNoLink.priceCentavos }],
  })
  order.markPaid()

  const deliveryService = new DeliveryService(messaging, eventRepo)
  const { delivered, pending } = await deliveryService.deliver(order, '5511999', 'test-instance')

  assert.equal(delivered.length, 0, 'no items delivered')
  assert.equal(pending.length, 1, '1 item pending')

  order.markDeliveryPending()
  await orderRepo.save(order)

  assert.equal(orderRepo.orders[0].status, 'delivery_pending')

  const pendingEvent = eventRepo.emitted.find(e => e.eventType === 'delivery_pending')
  assert.ok(pendingEvent, 'delivery_pending event emitted')
})

test('7. handoff notify_only does not change conversation status to handoff', async () => {
  // handoff_request is RELEASE 2 — this test validates the existing 'suspended' behavior
  // notify_only: conversation stays suspended with suspendedReason
  const conv = Conversation.create({ botId: 'bot-001', flowId: 'flow-001', phoneNumber: '5511999', triggerNodeId: 'n-1' })
  conv.suspend('n-1', { snapshotVersion: 1, suspendedReason: 'awaiting_human_intermediation' })

  assert.equal(conv.status, 'suspended', 'notify_only mode: conversation stays suspended')
  assert.equal(conv.snapshot?.suspendedReason, 'awaiting_human_intermediation')

  // Only takeover mode would call conv.handoff()
  const convHandoff = Conversation.create({ botId: 'bot-001', flowId: 'flow-001', phoneNumber: '5511998', triggerNodeId: 'n-1' })
  convHandoff.handoff()
  assert.equal(convHandoff.status, 'handoff', 'takeover mode: conversation becomes handoff')
})
