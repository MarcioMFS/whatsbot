import { compileFlow, validateFlowGraph, type FlowBrief, type CompiledFlow } from '@whatsbot/core'
import { createHash } from 'crypto'
import type { AIGenerationService } from './AIGenerationService.js'

// F3 — fonte dos padrões vencedores (implementada pelo PatternDistiller do F2). Tipo ESTRUTURAL:
// qualquer coisa com getPatternsForGeneration serve, sem acoplar o gerador ao distiller.
export interface GlobalPatternProvider {
  getPatternsForGeneration(vertical?: string): Promise<Record<string, Array<{ id: string; bucket: string; guidance: string; sampleTextAnon: string | null; status: string }>>>
}
type PatternMap = Awaited<ReturnType<GlobalPatternProvider['getPatternsForGeneration']>>

// Gerador de FLUXO ancorado em gabarito (Builder passo 5). A IA preenche um FlowBrief
// TIPADO (copy + intents do negócio) via cadeia FREE (NVIDIA→Groq); o compilador
// determinístico (core/flowTemplates) monta a topologia conhecida-boa e o validador
// mecânico garante que é executável. A IA NUNCA emite nó/edge — fragilidade contida.
// F3: o prompt deixa de ser estático — injeta os PADRÕES QUE MAIS CONVERTEM (store vivo do F2).
// NÃO persiste — devolve um grafo pendente pro gate humano. Ver Brain/spec_gerador_evolutivo.md.
export class FlowGenerationService {
  constructor(private ai: AIGenerationService, private patternProvider?: GlobalPatternProvider) {}

  // businessDescription = texto livre do dono ("vendo doramas dublados a R$6, pago no PIX...").
  async generate(businessDescription: string): Promise<CompiledFlow & { brief: FlowBrief; patternSetVersion: string | null; patternIds: string[] }> {
    const desc = (businessDescription ?? '').trim()

    // F3 — puxa os padrões vencedores (RAG few-shot). Degradação graciosa: sem provider/padrões,
    // o systemPrompt fica idêntico ao estático de antes. patternSetVersion carimba qual conjunto gerou.
    const patterns = await this.loadPatterns()
    const patternBlock = buildPatternBlock(patterns)
    const patternSetVersion = patternBlock ? versionOf(patterns) : null
    // F4 — os padrões que de fato entraram no bloco (top-3/campo), pra creditar performance depois.
    const patternIds = patternBlock ? Object.values(patterns).flatMap(ps => ps.slice(0, 3).map(p => p.id)) : []

    const systemPrompt = [
      'Você é um especialista em FUNIL de vendas no WhatsApp. A partir da descrição de um negócio — que pode ser inclusive uma PÁGINA DE VENDAS / landing inteira colada — você escreve o CONTEÚDO de um funil conversacional.',
      'Você NÃO desenha o fluxo nem cria etapas: a estrutura (busca, carrinho, PIX, validação do comprovante, entrega) é fixa. Você só escreve os textos de cada etapa e as frases-gatilho.',
      'Se a entrada for uma página de vendas, NÃO copie e cole o texto dela. EXTRAIA o essencial (promessa, oferta, preço, bônus, garantia) e TRANSFORME em mensagens curtas de conversa.',
      'FUNIL, não panfleto: cada mensagem tem UM trabalho só e NÃO repete as outras. ERRO GRAVE = dizer a oferta inteira (preço + bônus) em duas mensagens seguidas. Ritmo de conversa: abre leve → engaja → só então oferta.',
      '  • introMessage = SÓ a saudação + UM gancho (a promessa principal, 1-2 linhas). SEM preço, SEM lista de bônus, SEM "de R$X por R$Y" aqui.',
      '  • askMessage = uma PERGUNTA que engaja e convida a responder (ex.: "quer que eu te explique rapidinho como funciona?" ou "o que você procura?"). NÃO repita a oferta aqui.',
      '  • offerMessage = a oferta UMA vez (preço + bônus + garantia), conversacional. Preencha SÓ se o negócio tem UMA oferta principal pra empurrar (infoproduto / oferta única). Se for catálogo/loja com vários produtos, DEIXE VAZIO (a pessoa navega e escolhe).',
      'Regras de venda: tom humano e caloroso (sem cara de robô), espelhe o cliente, conduza pra ação (micro-compromisso), nunca prometa o que não pode cumprir.',
      'PROIBIDO datas/prazos na copy ("só hoje, 17/06", "até sexta", "termina amanhã"): você NÃO sabe a data real → vira urgência FALSA. Urgência só ATEMPORAL ("oferta especial", "por tempo limitado", "enquanto durar").',
      'PT-BR, curto e natural pra WhatsApp (1-2 emojis ok). Use os fatos REAIS do negócio.',
      ...(patternBlock ? [patternBlock] : []),
      'Campos do JSON:',
      '- flowName: nome curto do funil (ex.: "Funil Mapa da Bíblia")',
      '- businessName: nome do negócio',
      '- introMessage: saudação + gancho (regra acima — sem preço/bônus)',
      '- askMessage: pergunta de engajamento (regra acima — não é a oferta)',
      '- offerMessage: a oferta UMA vez, OU vazio se for catálogo (regra acima)',
      '- notFoundMessage: quando não acha o produto (peça o nome de outra forma ou o link, sem culpar o cliente)',
      '- cartSummaryTemplate: resumo do carrinho + chamada pra pagar. Mantenha os marcadores {{__rt_cart_summary}} e {{__rt_cart_total}} (o sistema preenche).',
      '- paymentConfirmedMessage: confirmação alegre após o pagamento',
      '- receiptAskMessage: pede o comprovante depois do PIX',
      '- handoffMessage: mensagem antes de passar pra um atendente humano (não diga que é um robô)',
      '- payPatterns: frases curtas, minúsculas, de "quero pagar/finalizar" (ex.: "quero pagar","gera o pix","pode cobrar")',
      '- supportPatterns: frases curtas, minúsculas, de dúvida/suporte/pedir humano',
      'Responda APENAS o JSON. Sem texto fora dele. Campos que não souber, omita (há padrão).',
    ].join('\n')

    const result = await this.ai.generateBuilder({
      systemPrompt,
      promptTemplate: `Descrição do negócio do lojista:\n"""\n${desc || '(não informada — gere um fluxo de vendas genérico e sólido)'}\n"""`,
      history: [],
      userMessage: 'Gere o conteúdo do fluxo de vendas para este negócio.',
      variables: {},
      temperature: 0.4,
      maxTokens: 2000,
    })

    const brief = parseBrief(result.content)
    const compiled = compileFlow(brief)

    // Defesa em profundidade: o compilador é determinístico, então isto SÓ falha se o
    // gabarito tiver bug — nunca por culpa da IA. Falhar aqui = erro de código, não de geração.
    const v = validateFlowGraph(compiled.nodes, compiled.edges)
    if (!v.ok) {
      throw new Error(`compilador gerou grafo inválido (bug do gabarito): ${v.errors.join('; ')}`)
    }

    return { ...compiled, brief, patternSetVersion, patternIds }
  }

  private async loadPatterns(): Promise<PatternMap> {
    if (!this.patternProvider) return {}
    try { return await this.patternProvider.getPatternsForGeneration() } catch { return {} }
  }
}

// Monta o bloco "padrões que mais convertem" pro systemPrompt (top-3 por campo). null se vazio.
function buildPatternBlock(patterns: PatternMap): string | null {
  const fields = Object.keys(patterns)
  if (!fields.length) return null
  const lines = ['PADRÕES QUE MAIS CONVERTEM (técnicas validadas — siga como guia e ADAPTE ao negócio; NÃO copie o exemplo literal):']
  for (const field of fields) {
    for (const p of patterns[field].slice(0, 3)) {
      const ex = p.sampleTextAnon ? `  (ex.: "${p.sampleTextAnon}")` : ''
      lines.push(`- ${field} [${p.bucket}]: ${p.guidance}${ex}`)
    }
  }
  return lines.join('\n')
}

// Versão determinística do conjunto de padrões (mesmo conjunto → mesma versão). Carimba o flow
// gerado pra o F4 medir depois qual conjunto converteu mais.
function versionOf(patterns: PatternMap): string {
  const sig = Object.entries(patterns)
    .flatMap(([f, ps]) => ps.map(p => `${f}:${p.bucket}:${p.status}`))
    .sort()
    .join('|')
  return 'ps_' + createHash('sha1').update(sig).digest('hex').slice(0, 10)
}

// Parse tolerante do brief: fatia do primeiro { ao último }, tenta JSON.parse; se truncar,
// devolve {} (briefWithDefaults preenche tudo → fluxo genérico válido, nunca quebra).
function parseBrief(raw: string): FlowBrief {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const o = parsed as Record<string, unknown>
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined)
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined)
  return {
    flowName: str('flowName'),
    businessName: str('businessName'),
    introMessage: str('introMessage'),
    askMessage: str('askMessage'),
    offerMessage: str('offerMessage'),
    notFoundMessage: str('notFoundMessage'),
    cartSummaryTemplate: str('cartSummaryTemplate'),
    paymentConfirmedMessage: str('paymentConfirmedMessage'),
    receiptAskMessage: str('receiptAskMessage'),
    handoffMessage: str('handoffMessage'),
    payPatterns: arr('payPatterns'),
    supportPatterns: arr('supportPatterns'),
  }
}
