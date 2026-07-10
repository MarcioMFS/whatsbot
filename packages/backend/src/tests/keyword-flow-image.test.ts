/**
 * Automated tests: keyword flow routing + image node
 *
 * Scenarios:
 * 1. New conversation whose message matches a keyword-trigger flow → that flow
 *    runs instead of the default (funis paralelos no mesmo número).
 * 2. Message that doesn't match any keyword → default flow runs.
 * 3. image node sends media (URL + interpolated caption) and continues the chain.
 * 4. image node send failure does NOT break the flow — next node still runs.
 * 5. Messaging port WITHOUT sendMedia → caption falls back to text, flow continues.
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
  type OutgoingMedia,
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
  async findById() { return null }
  async findByBotId() { return [] }
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
  media: OutgoingMedia[] = []
  failMedia = false
  async sendMessage(p: { phoneNumber: string; message: string }) { this.sent.push(p) }
  async sendMedia(m: OutgoingMedia) {
    if (this.failMedia) throw new Error('media host down')
    this.media.push(m)
  }
  async getInstanceStatus() { return { instanceName: 'test', state: 'open' as const } }
  async createInstance() { return { qrCode: '' } }
  async deleteInstance() {}
  async setWebhook() {}
  async connectInstance() { return { qrCode: '' } }
}

class TextOnlyMessaging implements MessagingPort {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// Default flow: trigger(any_message) → text "DEFAULT FLOW" → end
function makeDefaultFlow(): Flow {
  return Flow.reconstitute({
    id: 'flow-default',
    botId: 'bot-001',
    name: 'Default Flow',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: [
      { id: 'trg', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'any_message' } },
      { id: 'txt', type: 'text_message', position: { x: 0, y: 100 }, data: { label: 'Msg', message: 'DEFAULT FLOW' } },
      { id: 'end', type: 'end', position: { x: 0, y: 200 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'trg', target: 'txt' },
      { id: 'e2', source: 'txt', target: 'end' },
    ],
  })
}

// Keyword flow: trigger(keyword) → text → image (with caption var) → text → end
function makeKeywordFlow(): Flow {
  return Flow.reconstitute({
    id: 'flow-eduzzy',
    botId: 'bot-001',
    name: 'Eduzzy Funnel',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: [
      { id: 'trg', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerType: 'keyword', keywords: ['kit aula pronta'] } },
      { id: 'txt1', type: 'text_message', position: { x: 0, y: 100 }, data: { label: 'Msg', message: 'EDUZZY OPENING' } },
      { id: 'img', type: 'image', position: { x: 0, y: 200 }, data: { label: 'Hero', mediaUrl: 'https://cdn.test/hero.jpg', caption: 'Olá {{__lead_temperature}}' } },
      { id: 'txt2', type: 'text_message', position: { x: 0, y: 300 }, data: { label: 'Msg2', message: 'AFTER IMAGE' } },
      { id: 'end', type: 'end', position: { x: 0, y: 400 }, data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'trg', target: 'txt1' },
      { id: 'e2', source: 'txt1', target: 'img' },
      { id: 'e3', source: 'img', target: 'txt2' },
      { id: 'e4', source: 'txt2', target: 'end' },
    ],
  })
}

function makeService(flows: Flow[], messaging: MessagingPort) {
  const aiService = { generate: async () => ({ content: 'ok', tokensUsed: 0 }) } as any
  return new FlowExecutionService(
    new InMemFlowRepo(flows),
    new InMemConversationRepo(),
    new InMemLeadRepo(),
    messaging,
    aiService,
    new InMemEventRepo(),
  )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('new conversation matching keyword trigger routes to keyword flow, not default', async () => {
  const messaging = new InMemMessaging()
  const service = makeService([makeDefaultFlow(), makeKeywordFlow()], messaging)
  const bot = makeBot('flow-default')

  await service.handleIncomingMessage(bot, '5511988887777', 'Oi! Quero saber mais sobre o Kit Aula Pronta 💙')

  const msgs = messaging.sent.map(m => m.message)
  assert.ok(msgs.includes('EDUZZY OPENING'), 'keyword flow should run')
  assert.ok(!msgs.includes('DEFAULT FLOW'), 'default flow should NOT run')
})

test('new conversation without keyword falls back to default flow', async () => {
  const messaging = new InMemMessaging()
  const service = makeService([makeDefaultFlow(), makeKeywordFlow()], messaging)
  const bot = makeBot('flow-default')

  await service.handleIncomingMessage(bot, '5511988887777', 'oi, tudo bem?')

  const msgs = messaging.sent.map(m => m.message)
  assert.ok(msgs.includes('DEFAULT FLOW'), 'default flow should run')
  assert.ok(!msgs.includes('EDUZZY OPENING'), 'keyword flow should NOT run')
})

test('image node sends media with interpolated caption and continues the chain', async () => {
  const messaging = new InMemMessaging()
  const service = makeService([makeDefaultFlow(), makeKeywordFlow()], messaging)
  const bot = makeBot('flow-default')

  await service.handleIncomingMessage(bot, '5511988887777', 'kit aula pronta')

  assert.equal(messaging.media.length, 1, 'one media should be sent')
  assert.equal(messaging.media[0].mediaUrl, 'https://cdn.test/hero.jpg')
  assert.equal(messaging.media[0].mediaType, 'image')
  assert.ok(!messaging.media[0].caption?.includes('{{'), 'caption variables should be interpolated')

  const msgs = messaging.sent.map(m => m.message)
  assert.ok(msgs.includes('AFTER IMAGE'), 'node after image should still run')
})

test('image send failure does not break the flow', async () => {
  const messaging = new InMemMessaging()
  messaging.failMedia = true
  const service = makeService([makeDefaultFlow(), makeKeywordFlow()], messaging)
  const bot = makeBot('flow-default')

  await service.handleIncomingMessage(bot, '5511988887777', 'kit aula pronta')

  const msgs = messaging.sent.map(m => m.message)
  assert.ok(msgs.includes('EDUZZY OPENING'))
  assert.ok(msgs.includes('AFTER IMAGE'), 'flow must continue past a failed image')
})

test('messaging port without sendMedia falls back to caption as text', async () => {
  const messaging = new TextOnlyMessaging()
  const service = makeService([makeDefaultFlow(), makeKeywordFlow()], messaging)
  const bot = makeBot('flow-default')

  await service.handleIncomingMessage(bot, '5511988887777', 'kit aula pronta')

  const msgs = messaging.sent.map(m => m.message)
  assert.ok(msgs.some(m => m.startsWith('Olá ')), 'caption should be sent as plain text')
  assert.ok(msgs.includes('AFTER IMAGE'), 'flow must continue')
})
