import type { CartItem } from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'
import type { BotPersona } from './BotPersonaBuilder.js'

export type PaymentPhaseIntent =
  | 'receipt_sent'
  | 'payment_help'
  | 'edit_order'
  | 'cancel_order'
  | 'noise'
  | 'internal_takeover'

export interface PaymentPhaseDecision {
  intent: PaymentPhaseIntent
  reply: string
  confidence: number
}

export interface PaymentPhaseContext {
  userMessage: string
  lastBotMessage: string | null
  cartItems: CartItem[]
  cartTotalBrl: string
  paymentIntentId: string | null
  minutesSincePixGenerated: number
  hasImage: boolean
  persona?: BotPersona
}

const FALLBACK: PaymentPhaseDecision = {
  intent: 'noise',
  reply: 'Perfeito 😊 Qualquer hora me envie o comprovante do Pix!',
  confidence: 0.5,
}

// Deterministic patterns — checked before calling AI
const EDIT_ORDER_PATTERNS = [
  /\bquero trocar\b/i,
  /\bquero mudar\b/i,
  /\berrei\b/i,
  /\btira essa\b/i,
  /\btira (a|o|uma|um)\b/i,
  /\badicion(a|ar|e) mais (uma|um)\b/i,
  /\badicion(a|ar|e) outr[ao]\b/i,
  /\bquero outr[ao]\b/i,
  /\bescolhi errado\b/i,
  /\bmudar o pedido\b/i,
  /\btrocar o pedido\b/i,
  /\btrocar a série\b/i,
  /\bmudar a série\b/i,
  /\bcolocar mais\b/i,
  /\bmais uma série\b/i,
  /\bmais um(a)?\b.*s[eé]rie/i,
]

const CANCEL_ORDER_PATTERNS = [
  /\bdesisti\b/i,
  /\bcancela\b/i,
  /\bcancelar\b/i,
  /deixa pra l[aá]/i,
  /deixa para l[aá]/i,
  /\bn[aã]o quero mais\b/i,
  /\bsquece\b/i,        // "esquece" without leading e (typo common on mobile)
  /\besquece\b/i,
  /\bvou sair\b/i,
  /\bn[aã]o vou comprar\b/i,
  /\bdesistir\b/i,
]

function deterministicClassify(text: string): PaymentPhaseIntent | null {
  const t = text.trim()
  for (const pattern of CANCEL_ORDER_PATTERNS) {
    if (pattern.test(t)) return 'cancel_order'
  }
  for (const pattern of EDIT_ORDER_PATTERNS) {
    if (pattern.test(t)) return 'edit_order'
  }
  return null
}

function buildSystemPrompt(persona?: BotPersona): string {
  const identityBlock = persona
    ? persona.rulesBlock
    : `IDENTIDADE:\n- Você é o atendimento oficial.\n- Nunca mencione "humano", "atendente", "suporte" ou "transferência" para o cliente.`

  return `Você é um roteador de intenções para a fase de pagamento de um assistente de vendas no WhatsApp.
O cliente recebeu as instruções do Pix e o sistema aguarda o comprovante (imagem/print).

${identityBlock}

Retorne SOMENTE JSON válido, nenhum texto fora do JSON.

INTENTS disponíveis:
- receipt_sent: cliente afirma que pagou ou enviou comprovante sem ter enviado imagem ("paguei", "mandei", "fiz o pix", "transferi", "já enviei", "olha lá")
- payment_help: dúvida sobre como pagar ("qual a chave?", "como faço o pix?", "deu erro", "não consigo pagar", "qual o valor mesmo?")
- edit_order: quer alterar o pedido antes de pagar ("quero trocar", "errei o item", "adiciona mais uma", "muda para", "quero outra série", "tira essa", "quero mudar")
- cancel_order: quer desistir completamente ("não quero mais", "cancela", "desisti", "deixa pra lá", "esquece", "vou sair")
- noise: mensagem sem relação com o pagamento (risada, emoji solto, texto aleatório, "kkk", "ok", "sim", "entendi", "tá", saudação genérica)
- internal_takeover: situação que exige revisão especial — cliente irritado, problema confirmado com acesso já pago, reclamação explícita, erro grave, pedido de falar com "alguém"

REGRAS:
- Se o cliente disse que pagou mas NÃO enviou imagem → receipt_sent
- Ambiguidade entre noise e outra intent → prefira noise
- Dúvida entre internal_takeover e qualquer outra → prefira a outra
- reply deve ser string vazia quando o sistema vai responder automaticamente (receipt_sent, edit_order, cancel_order, internal_takeover)
- reply deve ter resposta curta e calorosa quando for payment_help ou noise

Formato de retorno:
{
  "intent": "<intent>",
  "reply": "<resposta curta em português informal, ou string vazia>",
  "confidence": <0.0 a 1.0>
}`
}

function formatCart(items: CartItem[], totalBrl: string): string {
  if (items.length === 0) return 'vazio'
  const list = items.map(i => `- ${i.name}`).join('\n')
  return `${items.length} série(s):\n${list}\nTotal: ${totalBrl}`
}

function plog(area: string, data: Record<string, unknown>): void {
  const parts = Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
  console.log(`[PaymentRouter:${area}] ${parts}`)
}

export class PaymentPhaseRouter {
  constructor(private aiService: AIGenerationService) {}

  async route(ctx: PaymentPhaseContext): Promise<PaymentPhaseDecision> {
    // Fast deterministic path — no AI cost for unambiguous phrases
    const deterministic = deterministicClassify(ctx.userMessage)
    if (deterministic) {
      plog('decision', {
        layer: 'payment_router',
        intent: deterministic,
        confidence: 0.95,
        usedFallback: false,
        usedAI: false,
        paymentIntentId: ctx.paymentIntentId,
        cartCount: ctx.cartItems.length,
        cartTotal: ctx.cartTotalBrl,
        minutesSincePixGenerated: ctx.minutesSincePixGenerated,
        msg: ctx.userMessage.slice(0, 80),
      })
      return { intent: deterministic, reply: '', confidence: 0.95 }
    }

    const userPrompt = `CONTEXTO:
- Carrinho: ${formatCart(ctx.cartItems, ctx.cartTotalBrl)}
- PaymentIntent ID: ${ctx.paymentIntentId ?? '(não encontrado)'}
- Minutos desde geração do Pix: ${ctx.minutesSincePixGenerated}
- Última mensagem do bot: "${ctx.lastBotMessage ?? '(nenhuma)'}"
- Mensagem tem imagem/anexo: ${ctx.hasImage ? 'SIM' : 'NÃO'}

MENSAGEM DO CLIENTE: "${ctx.userMessage}"

Retorne JSON:`

    const t0 = Date.now()

    try {
      const result = await this.aiService.generate('claude', {
        systemPrompt: buildSystemPrompt(ctx.persona),
        promptTemplate: userPrompt,
        history: [],
        userMessage: ctx.userMessage,
        variables: {},
        temperature: 0.1,
        maxTokens: 200,
      })

      const durationMs = Date.now() - t0

      // #8 performance
      plog('perf', {
        provider: 'claude',
        durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: result.cachedTokens ?? 0,
      })

      const raw = result.content.trim()
      const jsonStart = raw.indexOf('{')
      const jsonEnd = raw.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) {
        console.warn('[PaymentPhaseRouter] no JSON in response:', raw.slice(0, 100))
        plog('decision', { usedFallback: true, reason: 'no_json', durationMs })
        return FALLBACK
      }

      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Partial<PaymentPhaseDecision>

      const validIntents: PaymentPhaseIntent[] = [
        'receipt_sent', 'payment_help', 'edit_order', 'cancel_order', 'noise', 'internal_takeover',
      ]
      const intent = validIntents.includes(parsed.intent as PaymentPhaseIntent)
        ? (parsed.intent as PaymentPhaseIntent)
        : 'noise'
      const confidence = typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5

      // #2 PaymentPhaseRouter structured log
      plog('decision', {
        layer: 'payment_router',
        intent,
        confidence,
        usedAI: true,
        usedFallback: false,
        paymentIntentId: ctx.paymentIntentId,
        cartCount: ctx.cartItems.length,
        cartTotal: ctx.cartTotalBrl,
        minutesSincePixGenerated: ctx.minutesSincePixGenerated,
        msg: ctx.userMessage.slice(0, 80),
        durationMs,
      })

      return {
        intent,
        reply: typeof parsed.reply === 'string' ? parsed.reply : '',
        confidence,
      }
    } catch (err) {
      const durationMs = Date.now() - t0
      console.error('[PaymentPhaseRouter] error:', err instanceof Error ? err.message : err)
      plog('decision', { usedFallback: true, reason: 'exception', error: err instanceof Error ? err.message : String(err), durationMs })
      return FALLBACK
    }
  }
}
