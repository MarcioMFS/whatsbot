import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileFlow, validateFlowGraph } from '@whatsbot/core'
import type { AIProviderPort, AIGenerateResult } from '@whatsbot/core'
import { AIGenerationService } from '../services/AIGenerationService.js'
import { FlowGenerationService } from '../services/FlowGenerationService.js'

// Provider falso (mesmo padrão de builder-chain.test): marca se foi chamado.
function fake(name: string, onCall: () => AIGenerateResult): AIProviderPort & { called: boolean } {
  const p = { providerName: name, called: false, async generate(): Promise<AIGenerateResult> { p.called = true; return onCall() } }
  return p
}
const ok = (content: string): AIGenerateResult => ({ content, inputTokens: 0, outputTokens: 0 })
const data = (n: { data: unknown }) => n.data as Record<string, unknown>

// ── compilador ──────────────────────────────────────────────────────────────
test('compileFlow gera um grafo VÁLIDO (passa no validador mecânico)', () => {
  const { name, nodes, edges } = compileFlow({ businessName: 'Loja X' })
  assert.ok(name)
  const v = validateFlowGraph(nodes, edges)
  assert.equal(v.ok, true, v.errors.join('; '))
  assert.equal(nodes.filter(n => n.type === 'trigger').length, 1, 'exatamente 1 trigger')
  assert.ok(nodes.some(n => n.type === 'end'), 'tem nó terminal')
  // cobre o caminho de venda completo
  for (const t of ['catalog_search', 'cart_add', 'checkout', 'ai_validate_receipt', 'deliver_title']) {
    assert.ok(nodes.some(n => n.type === t), `tem nó ${t}`)
  }
})

test('compileFlow injeta a copy e os patterns do brief', () => {
  const intro = 'Bem-vindo à Loja do João! 👋'
  const { nodes } = compileFlow({ introMessage: intro, payPatterns: ['fechar agora'] })
  assert.equal(data(nodes.find(n => n.id === 'intro')!).message, intro)
  const intents = data(nodes.find(n => n.id === 'classify')!).intents as Array<{ handle: string; patterns?: string[] }>
  const pay = intents.find(i => i.handle === 'pay')!
  assert.ok(pay.patterns!.includes('fechar agora'), 'pattern do brief aplicado')
})

test('brief vazio compila um fluxo genérico VÁLIDO (defaults)', () => {
  const { nodes, edges } = compileFlow({})
  assert.equal(validateFlowGraph(nodes, edges).ok, true)
  assert.ok((data(nodes.find(n => n.id === 'intro')!).message as string).length > 0)
})

test('funil NÃO repete a oferta e tem ritmo: intro≠offer, offer é nó próprio, há delay', () => {
  const { nodes, edges } = compileFlow({ introMessage: 'Oi, que bom te ver! 🙏', askMessage: 'Quer que eu te explique?', offerMessage: 'De R$97 por R$29,90 + 3 bônus.' })
  assert.equal(validateFlowGraph(nodes, edges).ok, true)
  const intro = data(nodes.find(n => n.id === 'intro')!)
  const offer = nodes.find(n => n.id === 'offer')
  assert.ok(offer, 'offer vira nó próprio quando há oferta')
  assert.equal(data(offer!).message, 'De R$97 por R$29,90 + 3 bônus.')
  assert.ok(!(intro.message as string).includes('29,90'), 'intro NÃO repete a oferta (anti-panfleto)')
  assert.ok(nodes.some(n => n.type === 'delay'), 'tem delay entre mensagens (ritmo)')
})

test('sem offerMessage não cria nó offer (catálogo: a pessoa navega)', () => {
  const { nodes } = compileFlow({ askMessage: 'O que você procura?' })
  assert.equal(nodes.find(n => n.id === 'offer'), undefined)
})

// ── validador (a rede que o Flow.validate do domínio não tem) ─────────────────
test('validateFlowGraph reprova aresta pendurada (target inexistente)', () => {
  const { nodes, edges } = compileFlow({})
  const broken = [...edges, { id: 'x', source: 'trigger', sourceHandle: 'output', target: 'NAO_EXISTE', label: null }]
  const v = validateFlowGraph(nodes, broken)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some(e => e.includes('NAO_EXISTE')))
})

test('validateFlowGraph reprova handle obrigatório faltando', () => {
  const { nodes, edges } = compileFlow({})
  // tira o caminho not_found do catalog_search
  const filtered = edges.filter(e => !(e.source === 'search' && e.sourceHandle === 'not_found'))
  const v = validateFlowGraph(nodes, filtered)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some(e => e.includes('not_found')))
})

test('validateFlowGraph reprova nó órfão (inalcançável)', () => {
  const { nodes, edges } = compileFlow({})
  const withOrphan = [...nodes, { id: 'orphan', type: 'text_message' as const, position: { x: 0, y: 0 }, data: { label: 'x', message: 'y' } }]
  const v = validateFlowGraph(withOrphan, edges)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some(e => e.includes('orphan') && e.includes('inalcançável')))
})

test('validateFlowGraph exige exatamente 1 trigger', () => {
  const { nodes, edges } = compileFlow({})
  assert.equal(validateFlowGraph(nodes.filter(n => n.type !== 'trigger'), edges).ok, false)
})

// ── service (IA → brief → compila → valida), na cadeia FREE ───────────────────
test('FlowGenerationService: brief da IA vira fluxo VÁLIDO com a copy, sem tocar no claude', async () => {
  const brief = JSON.stringify({ flowName: 'Vendas Teste', introMessage: 'Oi! Bem-vindo 👋', payPatterns: ['quero fechar'] })
  const claude = fake('claude', () => ok('PAGO'))
  const nvidia = fake('nvidia', () => ok(brief))
  const svc = new FlowGenerationService(new AIGenerationService({ claude, groq: null, nvidia }))
  const r = await svc.generate('vendo coisas pelo whatsapp')
  assert.equal(r.name, 'Vendas Teste')
  assert.equal(validateFlowGraph(r.nodes, r.edges).ok, true)
  assert.equal(data(r.nodes.find(n => n.id === 'intro')!).message, 'Oi! Bem-vindo 👋')
  assert.equal(claude.called, false, 'builder NUNCA toca provider pago')
})

test('FlowGenerationService: lixo da IA (sem JSON) → fluxo genérico VÁLIDO (nunca quebra)', async () => {
  const nvidia = fake('nvidia', () => ok('desculpa, não entendi seu pedido'))
  const svc = new FlowGenerationService(new AIGenerationService({ claude: null, groq: null, nvidia }))
  const r = await svc.generate('')
  assert.equal(validateFlowGraph(r.nodes, r.edges).ok, true, 'fallback sempre válido')
  assert.ok(r.nodes.length > 5)
})

// ── F3: gerador consome os padrões vencedores (RAG) ──────────────────────────
const fakeProvider = (patterns: Record<string, Array<{ bucket: string; guidance: string; sampleTextAnon: string | null; status: string }>>) =>
  ({ getPatternsForGeneration: async () => patterns })

test('F3: com patternProvider, carimba patternSetVersion determinístico e gera válido', async () => {
  const nvidia = fake('nvidia', () => ok(JSON.stringify({ introMessage: 'Oi!' })))
  const provider = fakeProvider({ introMessage: [{ bucket: 'hook_warm', guidance: 'abra leve', sampleTextAnon: 'Oi 😊', status: 'seed' }] })
  const svc = new FlowGenerationService(new AIGenerationService({ claude: null, groq: null, nvidia }), provider)
  const r = await svc.generate('vendo x')
  assert.ok(r.patternSetVersion?.startsWith('ps_'), 'carimba versão')
  assert.equal(validateFlowGraph(r.nodes, r.edges).ok, true)
  const r2 = await svc.generate('vendo y')
  assert.equal(r.patternSetVersion, r2.patternSetVersion, 'mesmo conjunto → mesma versão')
})

test('F3: sem patternProvider → patternSetVersion=null (degradação graciosa = estático)', async () => {
  const nvidia = fake('nvidia', () => ok('{}'))
  const svc = new FlowGenerationService(new AIGenerationService({ claude: null, groq: null, nvidia }))
  const r = await svc.generate('x')
  assert.equal(r.patternSetVersion, null)
  assert.equal(validateFlowGraph(r.nodes, r.edges).ok, true)
})

test('F3: provider que falha NÃO derruba a geração (cai pro estático)', async () => {
  const nvidia = fake('nvidia', () => ok('{}'))
  const provider = { getPatternsForGeneration: async () => { throw new Error('db down') } }
  const svc = new FlowGenerationService(new AIGenerationService({ claude: null, groq: null, nvidia }), provider)
  const r = await svc.generate('x')
  assert.equal(r.patternSetVersion, null, 'falha do provider → estático, não quebra')
  assert.equal(validateFlowGraph(r.nodes, r.edges).ok, true)
})
