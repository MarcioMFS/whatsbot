import type { FlowNode, FlowEdge, NodeType, NodeData } from './Flow.js'

// ─────────────────────────────────────────────────────────────────────────────
// Gerador de fluxo ANCORADO EM GABARITO. Decisão de arquitetura (Marcio, 2026-06-18):
// a IA NÃO emite o grafo (frágil — Flow.validate só checa trigger; o executor tem
// 12+ armadilhas estruturais). A IA preenche um FlowBrief TIPADO (copy + intents +
// pacotes do negócio); este compilador determinístico monta a topologia conhecida-boa
// e o validateFlowGraph garante que ela é executável. "IA gera as folhas, o código
// monta a espinha." Ver Brain/spec_builder_improver.md (passo 5).
// ─────────────────────────────────────────────────────────────────────────────

// O intermediário tipado que a IA produz. Todos os campos são opcionais na entrada
// (a IA pode esquecer/errar) — briefWithDefaults() preenche o que faltar, então um
// brief vazio ainda compila num fluxo de vendas genérico VÁLIDO.
export interface FlowBrief {
  flowName?: string
  businessName?: string
  introMessage?: string          // boas-vindas (verbatim, 1º contato)
  askMessage?: string            // pergunta o que a pessoa quer
  offerMessage?: string          // oferta/upsell de pacote (opcional, anexado à pergunta)
  notFoundMessage?: string       // quando não acha o produto no catálogo
  cartSummaryTemplate?: string   // resumo do carrinho + CTA pra pagar
  paymentConfirmedMessage?: string
  receiptAskMessage?: string     // pede o comprovante após o PIX
  handoffMessage?: string        // antes de escalar pra humano
  payPatterns?: string[]         // frases que significam "quero pagar/finalizar"
  supportPatterns?: string[]     // frases de dúvida/suporte/humano
}

export type CompiledFlow = { name: string; nodes: FlowNode[]; edges: FlowEdge[] }

function clean(s: unknown): string | undefined {
  return typeof s === 'string' && s.trim() ? s.trim() : undefined
}
function cleanPatterns(arr: unknown): string[] | undefined {
  if (!Array.isArray(arr)) return undefined
  const out = arr.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim().toLowerCase())
  return out.length ? Array.from(new Set(out)) : undefined
}

// Preenche um brief parcial/sujo com defaults sólidos → nunca compila um fluxo quebrado.
export function briefWithDefaults(input: FlowBrief): Required<Omit<FlowBrief, 'offerMessage'>> & { offerMessage?: string } {
  return {
    flowName: clean(input.flowName) ?? 'Fluxo de Vendas',
    businessName: clean(input.businessName) ?? 'nossa loja',
    introMessage: clean(input.introMessage) ?? 'Olá! 😊 Seja bem-vindo(a). Posso te ajudar a encontrar o que você procura e finalizar pelo PIX, rapidinho e seguro.',
    askMessage: clean(input.askMessage) ?? 'Me diz o que você está procurando que eu já busco aqui pra você 🙂',
    offerMessage: clean(input.offerMessage),
    notFoundMessage: clean(input.notFoundMessage) ?? 'Hmm, não encontrei esse item por aqui 🤔 Pode me mandar o nome de outra forma, ou o link?',
    cartSummaryTemplate: clean(input.cartSummaryTemplate) ?? 'Seu pedido até agora:\n{{__rt_cart_summary}}\n\nTotal: {{__rt_cart_total}}\n\nPosso gerar o PIX pra você finalizar?',
    paymentConfirmedMessage: clean(input.paymentConfirmedMessage) ?? 'Pagamento confirmado! 🎉 Já vou te enviar o acesso.',
    receiptAskMessage: clean(input.receiptAskMessage) ?? 'Assim que pagar, me envia o comprovante (print ou PDF) que eu libero na hora 🚀',
    handoffMessage: clean(input.handoffMessage) ?? 'Vou te conectar com uma pessoa do time pra te ajudar melhor, só um instante 🙏',
    payPatterns: cleanPatterns(input.payPatterns) ?? ['quero pagar', 'pode gerar', 'gera o pix', 'manda o pix', 'finalizar', 'fechar pedido', 'pode cobrar', 'bora pagar'],
    supportPatterns: cleanPatterns(input.supportPatterns) ?? ['dúvida', 'duvida', 'ajuda', 'não entendi', 'nao entendi', 'problema', 'atendente', 'humano', 'falar com alguém'],
  }
}

// Compila o gabarito de VENDAS (catálogo → carrinho → PIX → validação → entrega) a
// partir do brief. Topologia + handles são fixos e garantidos válidos; a IA só pinta
// a copy e os patterns. IDs são estáveis (escopo do fluxo) — previsíveis e testáveis.
export function compileFlow(input: FlowBrief): CompiledFlow {
  const b = briefWithDefaults(input)
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  const X = 300, Y0 = 420, YH = 150
  const node = (id: string, type: NodeType, col: number, row: number, data: NodeData) => {
    nodes.push({ id, type, position: { x: col * X, y: Y0 + row * YH }, data: { ...data } })
  }
  const edge = (source: string, target: string, sourceHandle: string = 'output') => {
    edges.push({ id: `e_${source}__${sourceHandle}__${target}`, source, sourceHandle, target })
  }

  const hasOffer = !!b.offerMessage

  // ── espinha do funil: cada mensagem 1 trabalho, com PAUSAS entre elas (ritmo de conversa,
  // não panfleto). intro=gancho · ask=pergunta de engajamento · offer=pitch UMA vez (só single-offer). ──
  node('trigger', 'trigger', 0, 0, { label: 'Início', triggerType: 'any_message' })
  node('intro', 'text_message', 1, 0, { label: 'Boas-vindas (gancho)', message: b.introMessage })
  node('delay_intro', 'delay', 2, 0, { label: 'Pausa', seconds: 2 })
  node('ask', 'text_message', 3, 0, { label: 'Engajamento', message: b.askMessage })
  if (hasOffer) {
    node('delay_offer', 'delay', 4, 0, { label: 'Pausa', seconds: 2 })
    node('offer', 'text_message', 5, 0, { label: 'Oferta', message: b.offerMessage! })
  }
  node('wait', 'capture', 6, 0, {
    label: 'Aguardar mensagem', variableName: 'user_input', expectedInputType: 'any',
    timeoutMinutes: 20, timeoutMessage: 'Tô por aqui quando quiser continuar 😊', timeoutBehavior: 'suspend',
  })
  node('classify', 'classify_intent', 4, 0, {
    label: 'Entender intenção', messageVariable: 'user_input',
    intents: [
      { handle: 'pay', label: 'Finalizar / Pagar', patterns: b.payPatterns },
      { handle: 'support', label: 'Dúvida / Suporte', patterns: b.supportPatterns },
      { handle: 'browse', label: 'Buscar produto', isDefault: true },
    ],
  })

  // ── ramo: buscar produto (default) ──
  node('search', 'catalog_search', 5, 0, { label: 'Buscar no catálogo', searchFrom: 'user_input', maxResults: 5 })
  node('addcart', 'cart_add', 6, -1, { label: 'Adicionar ao carrinho' })
  node('cart', 'cart_summary', 7, -1, { label: 'Resumo do carrinho', messageTemplate: b.cartSummaryTemplate })
  node('notfound', 'text_message', 6, 1, { label: 'Não encontrado', message: b.notFoundMessage })

  // ── ramo: pagar ──
  node('need_item', 'text_message', 5, 3, { label: 'Carrinho vazio', message: 'Antes de gerar o PIX, me diz qual item você quer 🙂' })
  node('checkout', 'checkout', 6, 3, { label: 'Gerar PIX', expiresInMinutes: 60 })
  node('ask_receipt', 'text_message', 7, 3, { label: 'Pedir comprovante', message: b.receiptAskMessage })
  node('wait_receipt', 'capture', 8, 3, {
    label: 'Aguardar comprovante', variableName: 'receipt', expectedInputType: 'any',
    timeoutMinutes: 60, timeoutMessage: 'Quando enviar o comprovante eu libero na hora 🚀', timeoutBehavior: 'suspend',
  })
  node('validate', 'ai_validate_receipt', 9, 3, { label: 'Validar comprovante', paymentIntentVariable: '__rt_checkout_payment_id' })
  node('confirmed', 'payment_confirmed', 10, 3, { label: 'Pagamento confirmado', confirmationMessage: b.paymentConfirmedMessage })
  node('deliver', 'deliver_title', 11, 3, { label: 'Entregar acesso' })

  // ── escape / fim ──
  node('handoff', 'handoff_request', 10, 5, { label: 'Falar com humano', reason: 'escalated', userMessage: b.handoffMessage, notifyOwner: true })
  node('end', 'end', 12, 3, { label: 'Fim' })

  // ── arestas (handles explícitos onde o nó ramifica) ──
  edge('trigger', 'intro')
  edge('intro', 'delay_intro')
  edge('delay_intro', 'ask')
  if (hasOffer) {
    edge('ask', 'delay_offer')
    edge('delay_offer', 'offer')
    edge('offer', 'wait')
  } else {
    edge('ask', 'wait')
  }
  edge('wait', 'classify', 'responded')
  edge('wait', 'end', 'timeout')
  edge('classify', 'checkout', 'pay')
  edge('classify', 'handoff', 'support')
  edge('classify', 'search', 'browse')
  edge('search', 'addcart', 'found')
  edge('search', 'notfound', 'not_found')
  edge('addcart', 'cart', 'success')
  edge('addcart', 'handoff', 'error')
  edge('cart', 'wait')
  edge('notfound', 'wait')
  edge('need_item', 'wait')
  edge('checkout', 'ask_receipt', 'success')
  edge('checkout', 'need_item', 'error')
  edge('ask_receipt', 'wait_receipt')
  edge('wait_receipt', 'validate', 'responded')
  edge('wait_receipt', 'end', 'timeout')
  edge('validate', 'confirmed', 'approved')
  edge('validate', 'handoff', 'rejected')
  edge('confirmed', 'deliver')
  edge('deliver', 'end', 'done')
  edge('deliver', 'wait', 'more')
  edge('deliver', 'handoff', 'partial')
  edge('deliver', 'handoff', 'error')
  edge('handoff', 'end')

  return { name: b.flowName, nodes, edges }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validador MECÂNICO (não-IA). É a rede que o Flow.validate() do domínio NÃO cobre
// (ele só checa contagem de trigger). Roda no compilador (defesa em profundidade) E
// na rota /approve antes de persistir qualquer fluxo gerado. Se reprovar → re-gera
// (de graça) ou rejeita. NUNCA persiste grafo quebrado.
// ─────────────────────────────────────────────────────────────────────────────

// Handles obrigatórios por tipo de nó que ramifica. Se um desses não estiver cabeado,
// o executor "cai no undefined" naquele caminho (gotcha #2 da auditoria de nós).
const REQUIRED_HANDLES: Partial<Record<NodeType, string[]>> = {
  catalog_search: ['found', 'not_found'],
  cart_add: ['success', 'error'],
  checkout: ['success', 'error'],
  package_pix: ['success', 'error'],
  ai_validate_receipt: ['approved', 'rejected'],
  condition: ['true', 'false'],
  capture: ['responded'],        // timeout é recomendado mas opcional
  deliver_title: ['done'],       // more/partial/error opcionais
}
// Nós que podem legitimamente não ter saída (terminais).
const TERMINAL: ReadonlySet<NodeType> = new Set<NodeType>(['end'])

export interface FlowValidation { ok: boolean; errors: string[] }

export function validateFlowGraph(nodes: FlowNode[], edges: FlowEdge[]): FlowValidation {
  const errors: string[] = []
  if (!Array.isArray(nodes) || nodes.length === 0) return { ok: false, errors: ['fluxo sem nós'] }
  if (!Array.isArray(edges)) return { ok: false, errors: ['arestas inválidas'] }

  // ids únicos
  const ids = new Set<string>()
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) { errors.push('nó sem id'); continue }
    if (ids.has(n.id)) errors.push(`id de nó duplicado: ${n.id}`)
    ids.add(n.id)
  }

  // exatamente 1 trigger
  const triggers = nodes.filter(n => n.type === 'trigger')
  if (triggers.length !== 1) errors.push(`deve haver exatamente 1 nó trigger (achei ${triggers.length})`)

  // pelo menos 1 terminal
  if (!nodes.some(n => TERMINAL.has(n.type))) errors.push('fluxo sem nó terminal (end) — não tem como encerrar')

  // arestas apontam pra nós reais
  for (const e of edges) {
    if (!ids.has(e.source)) errors.push(`aresta ${e.id ?? '?'} sai de nó inexistente: ${e.source}`)
    if (!ids.has(e.target)) errors.push(`aresta ${e.id ?? '?'} aponta pra nó inexistente: ${e.target}`)
  }

  const outBySource = new Map<string, FlowEdge[]>()
  for (const e of edges) {
    const arr = outBySource.get(e.source) ?? []
    arr.push(e)
    outBySource.set(e.source, arr)
  }

  // todo nó não-terminal precisa de ao menos 1 saída
  for (const n of nodes) {
    if (TERMINAL.has(n.type)) continue
    if (!(outBySource.get(n.id)?.length)) errors.push(`nó "${n.id}" (${n.type}) não tem saída — beco sem saída`)
  }

  // handles obrigatórios cabeados nos nós que ramificam
  for (const n of nodes) {
    const required = REQUIRED_HANDLES[n.type]
    if (!required) continue
    const handles = new Set((outBySource.get(n.id) ?? []).map(e => e.sourceHandle ?? 'output'))
    for (const h of required) {
      if (!handles.has(h)) errors.push(`nó "${n.id}" (${n.type}) precisa do handle "${h}" cabeado`)
    }
  }

  // alcançabilidade a partir do trigger (BFS) — sem nós órfãos
  if (triggers.length === 1) {
    const seen = new Set<string>([triggers[0].id])
    const queue = [triggers[0].id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const e of outBySource.get(cur) ?? []) {
        if (!seen.has(e.target) && ids.has(e.target)) { seen.add(e.target); queue.push(e.target) }
      }
    }
    for (const n of nodes) {
      if (!seen.has(n.id)) errors.push(`nó "${n.id}" (${n.type}) é inalcançável a partir do início`)
    }
  }

  return { ok: errors.length === 0, errors }
}
