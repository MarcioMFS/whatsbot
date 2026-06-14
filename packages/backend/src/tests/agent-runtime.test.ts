import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Conversation, Cart, type Bot } from '@whatsbot/core'
import { AgentRuntime } from '../agent/AgentRuntime.js'
import { AGENT_TOOLS } from '../agent/tools/index.js'
import type { ToolContext, ToolServices } from '../agent/tools/types.js'
import type { IAgentProvider, CompleteRequest, ProviderResponse } from '../agent/providers/types.js'

// ── Fakes ──────────────────────────────────────────────────────────────────────

const PRODUCT = { id: 'p1', name: 'Cavaleiros do Sol', priceCentavos: 600, accessLink: 'https://acesso/cav' }

function mockServices(): ToolServices {
  return {
    catalogSearchService: { search: async (_b: string, q: string) => ({ products: [{ product: PRODUCT, confidence: 0.96, searchQuery: q }], unresolved: [] }) } as never,
    productRepo: { findById: async (id: string) => (id === 'p1' ? PRODUCT : null) } as never,
    packageOfferRepo: { findByBotId: async () => [] } as never,
    paymentIntentRepo: { save: async () => {} } as never,
    paymentOrchestrator: { processReceipt: async () => ({ decision: { approved: true, reason: 'approved', extracted: { confidence: 0.98 } }, userMessage: 'ok', shouldConfirm: true }) } as never,
  }
}

function mockBot(policy?: Record<string, boolean>): Bot {
  return {
    id: 'b1', name: 'DramaHub', activeFlowId: null,
    evolutionConfig: { instanceName: 'lab', instanceId: '' },
    globalConfig: { runtime: 'agent', companyName: 'DramaHub', defaultPixKey: 'pix@x.com', defaultReceiverName: 'X', ...(policy ? { agentPolicy: policy } : {}) },
  } as unknown as Bot
}

function ctxWithCart(withAccessLink = true): { ctx: ToolContext; conversation: Conversation } {
  const conversation = Conversation.create({ botId: 'b1', flowId: '__agent__', phoneNumber: '55999', triggerNodeId: '__agent__' })
  const cart = Cart.empty()
  cart.addItem({ productId: 'p1', name: 'Cavaleiros do Sol', priceCentavos: 600, accessLink: withAccessLink ? 'https://acesso/cav' : undefined })
  for (const [k, v] of Object.entries(cart.toVariables())) conversation.setVariable(k, v)
  return { ctx: { bot: mockBot(), conversation, lead: null, services: mockServices() }, conversation }
}

const tool = (name: string) => AGENT_TOOLS.find(t => t.name === name)!

// ── Guard / invariant tests (segurança do dinheiro) ────────────────────────────

test('generate_pix ignora valor do modelo — preço vem do carrinho', async () => {
  const { ctx, conversation } = ctxWithCart()
  const res = await tool('generate_pix').execute({ amount: 99999 } as never, ctx) // modelo tenta forçar valor
  assert.equal(res.success, true)
  assert.match(String((res.data as { amountBRL: string }).amountBRL), /6,00/) // 600, NÃO 99999
  assert.match(conversation.variables['__rt_checkout_final_total_brl'], /6,00/)
})

test('generate_pix recusa carrinho vazio', async () => {
  const conversation = Conversation.create({ botId: 'b1', flowId: '__agent__', phoneNumber: '55999', triggerNodeId: '__agent__' })
  const res = await tool('generate_pix').execute({}, { bot: mockBot(), conversation, lead: null, services: mockServices() })
  assert.equal(res.success, false)
  assert.equal(res.code, 'EMPTY_CART')
})

test('deliver_access bloqueia antes da confirmação e libera depois', async () => {
  const { ctx, conversation } = ctxWithCart()
  const blocked = await tool('deliver_access').execute({}, ctx)
  assert.equal(blocked.success, false)
  assert.equal(blocked.code, 'NOT_CONFIRMED')

  conversation.setVariable('__validation_approved', 'true') // pagamento confirmado
  const ok = await tool('deliver_access').execute({}, ctx)
  assert.equal(ok.success, true)
  assert.equal(ok.code, 'DELIVERED')
  assert.match(String((ok.data as { accessLinks: string }).accessLinks), /acesso\/cav/)
})

// ── Runtime — venda completa via FakeProvider (determinístico) ──────────────────

class FakeProvider implements IAgentProvider {
  readonly name = 'fake'
  private q: ProviderResponse[]
  constructor(script: Array<{ tool?: string; input?: Record<string, unknown>; text?: string }>) {
    this.q = script.map((s, i) => s.tool
      ? { stopReason: 'tool_use', toolCalls: [{ id: `c${i}`, name: s.tool, input: s.input ?? {} }] }
      : { stopReason: 'end', text: s.text ?? '', toolCalls: [] })
  }
  async complete(_req: CompleteRequest): Promise<ProviderResponse> {
    return this.q.shift() ?? { stopReason: 'end', text: '(fim)', toolCalls: [] }
  }
}

test('runtime: agente completa a venda (search → cart → pix → proof → deliver)', async () => {
  const store = new Map<string, Conversation>()
  const convRepo = { findActiveByPhone: async (_b: string, p: string) => store.get(p) ?? null, save: async (c: Conversation) => { store.set(c.phoneNumber, c) }, findById: async () => null, findByBotId: async () => [] }
  const leadRepo = { findByPhone: async () => null }
  const replies: string[] = []
  const messaging = { sendMessage: async ({ message }: { message: string }) => { replies.push(message) } }

  const script = [
    { tool: 'search_catalog', input: { query: 'Cavaleiros do Sol' } }, { text: 'Temos! R$ 6,00. Quer comprar?' },          // turn 1
    { tool: 'add_to_cart', input: { productId: 'p1' } }, { tool: 'generate_pix' }, { text: 'PIX gerado, segue a chave.' },   // turn 2
    { tool: 'validate_proof' }, { tool: 'deliver_access' }, { text: 'Prontinho, segue seu acesso!' },                        // turn 3
  ]
  const rt = new AgentRuntime(new FakeProvider(script), convRepo as never, leadRepo as never, messaging as never, mockServices())
  const bot = mockBot()

  await rt.handleIncomingMessage(bot, '55999', 'tem a série Cavaleiros do Sol?')
  await rt.handleIncomingMessage(bot, '55999', 'quero comprar')
  await rt.handleIncomingMessage(bot, '55999', 'segue o comprovante', 'ZmFrZQ==')

  const conv = store.get('55999')!
  assert.equal(replies.length, 3)
  assert.equal(conv.phase, 'post_purchase')
  assert.ok(conv.variables['__rt_checkout_payment_id'], 'PIX deve ter sido gerado')
  assert.equal(conv.variables['__validation_approved'], 'true')
})
