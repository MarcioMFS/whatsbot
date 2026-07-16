/**
 * E2E do FUNIL NOTA DEZ — roda o flow REAL de produção (fixtures/notadez-flow.json,
 * espelho exato do banco) contra o FlowExecutionService de verdade, com personas
 * simuladas. Cada cenário aqui nasceu de um bug REAL que travou/queimou cliente:
 *
 *  - "Sim" MAIÚSCULO rejeitado (case-sensitive) → auto-handoff indevido
 *  - "3 a 4 anos" mapeado pro item errado do menu (primeiro dígito)
 *  - handoff seguia pro nó end → conversa encerrava → funil reiniciava por cima do humano
 *  - "já paguei" sem comprovante (nunca pode confirmar)
 *  - comprador reiniciando o funil de venda
 *  - comprovante atrasado reiniciando o funil
 *
 * REGRA DE DEPLOY: nenhuma mudança de flow vai pro banco sem esta suíte verde
 * (scripts/flow_deploy.py roda ela automaticamente).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  Conversation, Lead, Flow, Bot, PaymentIntent,
  type ConversationRepository, type LeadRepository, type FlowRepository,
  type MessagingPort, type OutgoingMedia, type ConversationEventRepository,
  type ConversationEvent, type PaymentIntentRepository, type FlowNode,
} from '@whatsbot/core'
import { FlowExecutionService } from '../services/FlowExecutionService.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(__dir, 'fixtures/notadez-flow.json'), 'utf8'))

const BOT_ID = FIXTURE.botId as string

// ─── Stubs ───────────────────────────────────────────────────────────────────

class InMemConversationRepo implements ConversationRepository {
  store = new Map<string, Conversation>()
  async findActiveByPhone(botId: string, phone: string) { return this.store.get(`${botId}:${phone}`) ?? null }
  async findById() { return null }
  async findByBotId() { return [] }
  async save(conv: Conversation) {
    if (conv.status === 'ended') this.store.delete(`${conv.botId}:${conv.phoneNumber}`)
    else this.store.set(`${conv.botId}:${conv.phoneNumber}`, conv)
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
  texts: Array<{ phone: string; message: string }> = []
  media: Array<OutgoingMedia & { phone: string }> = []
  async sendMessage(p: { phoneNumber: string; message: string }) { this.texts.push({ phone: p.phoneNumber, message: p.message }) }
  async sendMedia(m: OutgoingMedia) { this.media.push({ ...m, phone: m.phoneNumber }) }
  async sendPresence() {}
  async getInstanceStatus() { return { instanceName: 't', state: 'open' as const } }
  async createInstance() { return { qrCode: '' } }
  async deleteInstance() {}
  async setWebhook() {}
  async connectInstance() { return { qrCode: '' } }
  clear() { this.texts = []; this.media = [] }
  get all() { return this.texts.map(t => t.message) }
}

class InMemEventRepo implements ConversationEventRepository {
  events: ConversationEvent[] = []
  async emit(e: ConversationEvent) { this.events.push(e) }
  async findByBot() { return [] }
  async findByPhone() { return [] }
  async countByType() { return 0 }
}

class InMemIntentRepo implements PaymentIntentRepository {
  store = new Map<string, PaymentIntent>()
  async save(i: PaymentIntent) { this.store.set(i.id, i) }
  async findById(id: string) { return this.store.get(id) ?? null }
  async findPendingByConversation(convId: string) {
    return [...this.store.values()].find(i => i.conversationId === convId && i.status === 'pending') ?? null
  }
  async findPendingOlderThan() { return [] }
}

// Orquestrador de pagamento: aprova apenas o token mágico RECEIPT_OK
const orchestratorStub = {
  processReceipt: async ({ imageBase64 }: { imageBase64: string }) => ({
    decision: { approved: imageBase64 === 'RECEIPT_OK', reason: imageBase64 === 'RECEIPT_OK' ? 'approved' : 'not_a_receipt', debugInfo: {} },
    userMessage: imageBase64 === 'RECEIPT_OK' ? 'Pagamento confirmado! 🎉' : 'Hmm, não consegui confirmar esse comprovante 🤔',
  }),
} as never

function makeBot(opts: { routingRules?: Array<{ tag: string; flowId: string }> } = {}): Bot {
  return Bot.reconstitute({
    id: BOT_ID,
    name: 'Nota Dez (teste)',
    productInfo: { name: 'Kit Aula Pronta', description: '', persona: '', language: 'pt-BR' },
    aiConfig: { provider: 'gemini', model: 'x', temperature: 0.5, maxTokens: 400, systemPromptTemplate: '' },
    evolutionConfig: { instanceName: 'test' },
    activeFlowId: FIXTURE.id,
    routingRules: opts.routingRules ?? [],
    isActive: true,
    webhookSecret: 's',
    ownerId: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    // typingSimulation OFF (teste rápido); autoHandoff default (2 rejeições)
    globalConfig: { ownerPhone: '5500000000000', capabilityRouterEnabled: false },
  } as never)
}

function loadFlow(): Flow {
  return Flow.reconstitute({
    id: FIXTURE.id, botId: BOT_ID, name: FIXTURE.name,
    nodes: FIXTURE.nodes as FlowNode[], edges: FIXTURE.edges,
    isDefault: true, createdAt: new Date(), updatedAt: new Date(),
  })
}

// Flow mínimo de pós-venda (regra por tag buyer) — espelha o de produção
function supportFlow(): Flow {
  return Flow.reconstitute({
    id: 'flow-posvenda', botId: BOT_ID, name: 'Pós-venda',
    nodes: [
      { id: 'trg', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'PV', triggerType: 'any_message' } },
      { id: 'notif', type: 'notification', position: { x: 0, y: 1 }, data: { label: 'n', phoneNumber: '5500000000000', message: 'PV: {{message}}' } },
      { id: 'end', type: 'end', position: { x: 0, y: 2 }, data: { label: 'Fim' } },
    ],
    edges: [
      { id: 'e1', source: 'trg', target: 'notif', sourceHandle: null, targetHandle: null },
      { id: 'e2', source: 'notif', target: 'end', sourceHandle: null, targetHandle: null },
    ],
    isDefault: false, createdAt: new Date(), updatedAt: new Date(),
  })
}

interface Rig {
  svc: FlowExecutionService
  msgs: InMemMessaging
  convs: InMemConversationRepo
  leads: InMemLeadRepo
}

function rig(opts: { routingRules?: Array<{ tag: string; flowId: string }> } = {}): Rig & { bot: Bot } {
  const msgs = new InMemMessaging()
  const convs = new InMemConversationRepo()
  const leads = new InMemLeadRepo()
  const svc = new FlowExecutionService(
    new InMemFlowRepo([loadFlow(), supportFlow()]),
    convs, leads, msgs,
    { generate: async () => ({ content: 'stub', tokensUsed: 0 }) } as never,
    new InMemEventRepo(),
    orchestratorStub,
    new InMemIntentRepo(),
  )
  return { svc, msgs, convs, leads, bot: makeBot(opts) }
}

const PHONE = '5511977776666'

/** conduz o funil v9 até ficar aguardando no capture alvo */
async function walkTo(r: Rig & { bot: Bot }, target: 'c_faixa' | 'c_amostra' | 'c_fecho' | 'c5') {
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'Olá! Posso ter mais informações sobre isso?')
  if (target === 'c_faixa') return
  await r.svc.handleIncomingMessage(r.bot, PHONE, '1')              // faixa direto (menu)
  if (target === 'c_amostra') return
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'SIM')            // MAIÚSCULO de propósito
  if (target === 'c_fecho') return
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'QUERO RESOLVER') // fecho → pix → c5
}

function convOf(r: Rig): Conversation | undefined {
  return r.convs.store.get(`${BOT_ID}:${PHONE}`)
}

// ─── 0. Invariantes do grafo ─────────────────────────────────────────────────

test('grafo: edges íntegras, captures com timeout, regex compila, sem CAIXA ALTA', () => {
  const ids = new Set(FIXTURE.nodes.map((n: FlowNode) => n.id))
  for (const ed of FIXTURE.edges) {
    assert.ok(ids.has(ed.source), `edge source órfão: ${ed.source}`)
    assert.ok(ids.has(ed.target), `edge target órfão: ${ed.target}`)
  }
  for (const n of FIXTURE.nodes as FlowNode[]) {
    if (n.type === 'capture') {
      const outs = FIXTURE.edges.filter((e: { source: string }) => e.source === n.id)
      assert.ok(outs.some((e: { sourceHandle?: string | null }) => e.sourceHandle !== 'timeout'), `${n.id} sem saída normal`)
      assert.ok(outs.some((e: { sourceHandle?: string | null }) => e.sourceHandle === 'timeout'), `${n.id} sem saída timeout`)
      const rx = (n.data as { validationRegex?: string }).validationRegex
      if (rx) new RegExp(rx, 'i') // compila ou explode o teste
    }
    const msg = (n.data as { message?: string }).message ?? ''
    const caps = msg.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{6,}\b/g) ?? []
    assert.equal(caps.length, 0, `${n.id} com CAIXA ALTA (sinal de spam): ${caps.join(',')}`)
    if (n.type === 'distributor') {
      const v = (n.data as { variations?: string[] }).variations ?? []
      assert.ok(v.length >= 2, 'distributor sem variações')
    }
  }
})

// ─── 1. Caminho feliz completo (com as pegadinhas que já quebraram) ──────────

test('caminho feliz v9: problema → faixa "1" → amostra real → QUERO RESOLVER → pix 19,90 → comprovante → entrega', async () => {
  const r = rig()

  await r.svc.handleIncomingMessage(r.bot, PHONE, 'Olá! Posso ter mais informações sobre isso?')
  assert.equal(convOf(r)?.currentNodeId, 'c_faixa')
  assert.equal(r.msgs.texts.length, 1, 'abertura em 1 bolha (problema + faixa)')

  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, '1')    // ← menu
  assert.equal(convOf(r)?.currentNodeId, 'c_amostra')
  assert.ok(r.msgs.all.some(m => m.includes('2 a 3 anos')), 'menu "1" vira rótulo "2 a 3 anos"')
  assert.equal(r.msgs.media.filter(m => m.mediaType === 'audio').length, 1, 'voice note da dor enviado')
  assert.ok(r.msgs.media.some(m => (m.mediaType ?? 'image') === 'image'), 'capa do kit enviada na etapa da solução')

  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'SIM')  // ← case-insensitive
  assert.equal(convOf(r)?.currentNodeId, 'c_fecho', '"SIM" maiúsculo avança pra oferta')
  const vids = r.msgs.media.filter(m => m.mediaType === 'video')
  assert.equal(vids.length, 1, 'amostra em vídeo enviada')
  assert.ok(vids[0].mediaUrl.includes('amostra-video'), 'URL do vídeo de amostra')
  assert.equal(r.msgs.media.filter(m => m.mediaType === 'audio').length, 1, 'voice note do fechamento enviado')
  assert.ok(r.msgs.all.some(m => m.includes('quero resolver')), 'CTA escrito acompanha o áudio do fechamento')
  assert.ok(r.msgs.all.some(m => m.includes('R$ 47,90')), 'âncora R$47,90 presente')
  assert.ok(r.msgs.all.some(m => m.includes('19,90')), 'condição 19,90 presente')

  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'QUERO RESOLVER')
  assert.equal(convOf(r)?.currentNodeId, 'c5')
  const last = r.msgs.all[r.msgs.all.length - 1]
  assert.equal(last, 'equipenotadez@jim.com', 'chave pix isolada na última bolha (copiável)')
  assert.ok(r.msgs.all.some(m => m.includes('19,90')), 'pix no valor 19,90')
  assert.ok(convOf(r)?.variables['paymentIntentId'], 'PaymentIntent criado')

  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, '[image]', 'RECEIPT_OK')
  const lead = await r.leads.findByPhone(BOT_ID, PHONE)
  assert.ok(lead?.tags.includes('buyer'), 'comprador ganha tag buyer')
  assert.equal(r.msgs.media.filter(m => m.mediaType === 'document').length, 16, 'entrega dos 16 PDFs')
  assert.ok(r.msgs.all.some(m => m.includes('bônus surpresa')), 'mensagem final da entrega')
})

// ─── 2. Faixa por extenso não mapeia pro item errado ─────────────────────────

test('faixa "3 a 4 anos" por extenso fica verbatim (não vira item 3 do menu)', async () => {
  const r = rig()
  await walkTo(r, 'c_faixa')
  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, '3 a 4 anos')
  assert.ok(r.msgs.all.some(m => m.includes('3 a 4 anos')), 'eco correto')
  assert.ok(!r.msgs.all.some(m => m.includes('4 a 5 anos')), 'não pode mapear pro item 3')
})

// ─── 3. Aparte: pergunta não avança; re-âncora; 2º aparte → handoff TERMINAL ──

test('pergunta no fechamento: re-âncora sem avançar; 2ª ESPAÇADA → handoff terminal; msgs seguintes ignoradas', async () => {
  const r2 = rig()
  await walkTo(r2, 'c_fecho')
  assert.equal(convOf(r2)?.currentNodeId, 'c_fecho')

  r2.msgs.clear()
  await r2.svc.handleIncomingMessage(r2.bot, PHONE, 'É impresso ou digital?')
  assert.equal(convOf(r2)?.currentNodeId, 'c_fecho', 'pergunta NÃO avança o funil')
  assert.ok(r2.msgs.all.some(m => m.toLowerCase().includes('quero resolver')), 're-âncora repete a pergunta do funil')
  assert.ok(!r2.msgs.all.some(m => m.includes('equipenotadez')), 'não pode ter avançado pro pix')

  // simula ESPAÇAMENTO (>30s/60s): rejeição espaçada de verdade conta pro escalonamento
  const conv1 = convOf(r2)!
  conv1.setVariable('__capture_reject_at', String(Date.now() - 40_000))
  conv1.setVariable('__capture_errmsg_at', String(Date.now() - 70_000))

  r2.msgs.clear()
  await r2.svc.handleIncomingMessage(r2.bot, PHONE, 'e vem apostila junto?')
  assert.equal(convOf(r2)?.status, 'handoff', '2º aparte ESPAÇADO escala pro humano')

  r2.msgs.clear()
  await r2.svc.handleIncomingMessage(r2.bot, PHONE, 'alô?')
  assert.equal(r2.msgs.texts.length, 0, 'handoff é mudo (nada de funil por cima do humano)')
  assert.equal(convOf(r2)?.status, 'handoff', 'handoff é TERMINAL (não vira ended)')
})

test('RAJADA no fechamento: 2 msgs seguidas NÃO escalam nem repetem o aparte; funil segue vivo', async () => {
  const r = rig()
  await walkTo(r, 'c_fecho')

  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'tem parcelado?')
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'tem pra maternal?')   // <30s depois (rajada)
  assert.notEqual(convOf(r)?.status, 'handoff', 'rajada NÃO escala pro dono')
  assert.equal(convOf(r)?.currentNodeId, 'c_fecho', 'continua aguardando no mesmo lugar')
  const apartes = r.msgs.all.filter(m => m.toLowerCase().includes('quero resolver')).length
  assert.equal(apartes, 1, 'aparte enviado UMA vez (sem papagaio)')

  // e a resposta válida em seguida DESCE o funil normalmente
  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'quero resolver sim')
  assert.equal(convOf(r)?.currentNodeId, 'c5', 'resposta válida avança pro pix')
  assert.ok(r.msgs.all.includes('equipenotadez@jim.com'), 'pix enviado')
})

// ─── 4. Objeção de preço → downsell imediato ─────────────────────────────────

test('objeção de agenda no pós-pix é acolhida (garantia) e o funil segue aguardando', async () => {
  const r = rig()
  await walkTo(r, 'c5')
  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'Só recebo semana que vem')
  assert.ok(r.msgs.all.some(m => m.includes('garantia')), 'acolhe com garantia, sem pressão')
  assert.ok(!r.msgs.all.some(m => m.includes('não consegui confirmar')), 'não é rejeição de comprovante')
  assert.equal(convOf(r)?.currentNodeId, 'c5', 'continua aguardando o comprovante/retorno')
})

// ─── 5. "Já paguei" sem comprovante nunca confirma ───────────────────────────

test('"já paguei" (texto, sem print) → pede o comprovante; jamais confirma', async () => {
  const r = rig()
  await walkTo(r, 'c5')
  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'já paguei')
  assert.ok(!r.msgs.all.some(m => m.includes('Pagamento confirmado')), 'NUNCA confirmar por texto')
  assert.equal(r.msgs.media.filter(m => m.mediaType === 'document').length, 0, 'nada de entrega')
  const lead = await r.leads.findByPhone(BOT_ID, PHONE)
  assert.ok(!lead?.tags.includes('buyer'), 'sem tag buyer')
})

// ─── 6. Comprador nunca reinicia o funil de venda ────────────────────────────

test('lead com tag buyer roteia pro pós-venda (não recebe abertura de venda)', async () => {
  const r = rig({ routingRules: [{ tag: 'buyer', flowId: 'flow-posvenda' }] })
  const lead = Lead.create({ botId: BOT_ID, phoneNumber: PHONE })
  lead.addTag('buyer')
  await r.leads.save(lead)

  await r.svc.handleIncomingMessage(r.bot, PHONE, 'Deus abençoe grandemente!')
  assert.ok(!r.msgs.all.some(m => m.includes('Juliana')), 'abertura de venda NÃO pode disparar pra comprador')
})

// ─── 7. Comprovante atrasado não reinicia o funil ────────────────────────────

test('imagem como 1ª msg de lead que já chegou no pix → confirmação humana, sem reinício', async () => {
  const r = rig()
  const lead = Lead.create({ botId: BOT_ID, phoneNumber: PHONE })
  lead.addTag('eduzzy-checkout')
  await r.leads.save(lead)

  await r.svc.handleIncomingMessage(r.bot, PHONE, '[image]', 'QUALQUER_IMAGEM')
  assert.ok(r.msgs.all.some(m => m.includes('confirmar seu pagamento')), 'mensagem de confirmação humana')
  assert.ok(!r.msgs.all.some(m => m.includes('Juliana')), 'funil NÃO reinicia por cima de comprovante atrasado')
  assert.equal(convOf(r)?.status, 'handoff')
})

// ─── 8. Controle manual: disparar o funil de um nó específico (goto da tela) ──
// Mesma mecânica da rota POST /conversations/bot/:botId/phone/:phone/goto:
// moveToNode(nó) + resumeFromNode — as bolhas do ponto escolhido saem AGORA.

test('goto volta o funil: lead no c5 re-dispara a âncora (t6) — preço sai de novo e espera no c_fecho', async () => {
  const r = rig()
  await walkTo(r, 'c5')
  r.msgs.clear()
  const conv = convOf(r)!
  conv.moveToNode('t6')
  await r.svc.resumeFromNode(r.bot, loadFlow(), conv)
  assert.equal(convOf(r)?.currentNodeId, 'c_fecho', 'para de novo no fechamento')
  assert.ok(r.msgs.all.some(m => m.includes('R$ 47,90')), 'âncora reenviada')
  assert.ok(r.msgs.all.some(m => m.includes('quero resolver')), 'fechamento reenviado')
})

test('goto adianta o funil: lead na faixa vai direto pro pix — chave na última bolha, espera no c5', async () => {
  const r = rig()
  await walkTo(r, 'c_faixa')
  r.msgs.clear()
  const conv = convOf(r)!
  conv.moveToNode('t_pix_after')
  await r.svc.resumeFromNode(r.bot, loadFlow(), conv)
  assert.equal(convOf(r)?.currentNodeId, 'c5')
  assert.equal(r.msgs.all[r.msgs.all.length - 1], 'equipenotadez@jim.com', 'chave pix isolada na última bolha')
  assert.ok(r.msgs.all.some(m => m.includes('19,90')), 'pix no valor 19,90')
})

test('goto revive conversa em handoff: disparar um nó devolve pro bot naquele ponto', async () => {
  const r = rig()
  await walkTo(r, 'c_fecho')
  const conv = convOf(r)!
  conv.handoff()
  await r.convs.save(conv)
  r.msgs.clear()
  conv.moveToNode('t7_cta')
  await r.svc.resumeFromNode(r.bot, loadFlow(), conv)
  assert.equal(convOf(r)?.status, 'waiting', 'sai do handoff e volta a esperar o lead')
  assert.equal(convOf(r)?.currentNodeId, 'c_fecho')
  assert.ok(r.msgs.all.some(m => m.includes('quero resolver')))
})

// ─── 9. Nome do cliente: pushName do WhatsApp vira saudação na abertura ───────

test('pushName "🌸 Profª Maria Clara" → abertura "Oi, Maria!" e lead.name=Maria', async () => {
  const r = rig()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'quero saber do kit', undefined, { pushName: '🌸 Profª Maria Clara' })
  const open = r.msgs.all[0] ?? ''
  assert.ok(open.includes(', Maria!'), `abertura deveria saudar pelo nome: "${open.slice(0, 60)}"`)
  assert.ok(!open.includes('{{'), 'template cru vazou pro cliente')
  const lead = await r.leads.findByPhone(BOT_ID, PHONE)
  assert.equal(lead?.name, 'Maria')
})

test('pushName inutilizável ("👑 .") → saudação neutra, sem vírgula órfã nem template cru', async () => {
  const r = rig()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'quero saber do kit', undefined, { pushName: '👑 .' })
  const open = r.msgs.all[0] ?? ''
  assert.ok(/^(Oi|Olá)! /.test(open), `saudação neutra esperada: "${open.slice(0, 40)}"`)
  assert.ok(!open.includes('{{'), 'template cru vazou pro cliente')
})

// ─── 10. Downsell: objeção de preço pós-pix → oferta final 14,90 imediata ─────

test('objeção "tá caro" no pós-pix → downsell 14,90 com pix novo, volta a aguardar comprovante', async () => {
  const r = rig()
  await walkTo(r, 'c5')
  r.msgs.clear()
  await r.svc.handleIncomingMessage(r.bot, PHONE, 'tá caro, não tenho esse valor agora')
  assert.ok(r.msgs.all.some(m => m.includes('14,90')), 'downsell 14,90 oferecido')
  assert.equal(r.msgs.all[r.msgs.all.length - 1], 'equipenotadez@jim.com', 'chave pix do downsell na última bolha')
  assert.equal(convOf(r)?.currentNodeId, 'c5', 'segue aguardando o comprovante')
  assert.ok(!r.msgs.all.some(m => m.includes('Pagamento confirmado')), 'objeção nunca confirma pagamento')
})
