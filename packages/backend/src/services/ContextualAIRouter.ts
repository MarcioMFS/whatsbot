import type { CartItem } from '@whatsbot/core'
import type { Message } from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'
import type { BotPersona } from './BotPersonaBuilder.js'
import type { PostgreSQLAIDecisionRepository } from '../adapters/PostgreSQLAIDecisionRepository.js'

export type RouterIntent =
  | 'ack'
  | 'title_search'
  | 'partial_search'
  | 'recommendation_request'
  | 'catalog'
  | 'checkout'
  | 'payment_receipt'
  | 'doubt'
  | 'returning_user'
  | 'price_issue'
  | 'negative_finish'
  | 'unknown_noise'
  | 'unknown_handoff'
  | 'unknown'

export type RouterNextAction =
  | 'respond_only'
  | 'search_catalog'
  | 'catalog_recommendation'
  | 'show_catalog'
  | 'checkout'
  | 'wait_receipt'
  | 'continue_previous_step'
  | 'human_support'

export interface RouterDecision {
  intent: RouterIntent
  reply: string
  nextAction: RouterNextAction
  shouldResetFlow: boolean
  // title/partial search — extracted keyword to use in catalog_search instead of raw message
  candidateQuery?: string
  // recommendation flow — collected preferences
  genrePreference?: string       // e.g. "ação", "romance", "suspense"
  typePreference?: string        // e.g. "k-drama", "turca", "brasileira"
  preferencesComplete?: boolean  // true when both genre and type collected
}

export interface RouterContext {
  userMessage: string
  history: Message[]
  phase: string
  lastBotMessage: string | null
  cartItems: CartItem[]
  cartTotalBrl: string
  hasPendingPayment: boolean
  minutesSinceLastMessage: number
  returningUserThreshold: number
  botContext: string
  persona?: BotPersona
  // saved preferences from previous turns
  savedGenrePref?: string
  savedTypePref?: string
  // detected question type — helps Claude interpret "sim"/"não" correctly
  lastBotQuestionType?: 'want_more_items' | 'confirm_suggested_title' | 'confirm_checkout' | 'unknown'
  // audit
  botId?: string
  conversationId?: string
  phoneNumber?: string
}

const FALLBACK_DECISION: RouterDecision = {
  intent: 'unknown_noise',
  reply: '',
  nextAction: 'respond_only',
  shouldResetFlow: false,
}

function buildSystemPrompt(botContext: string, persona?: BotPersona): string {
  const identityBlock = persona
    ? `${persona.rulesBlock}`
    : `IDENTIDADE:\n- Você é o atendimento oficial.\n- Nunca mencione "humano", "atendente", "suporte" ou "transferência" para o cliente.`

  return `Você é um roteador de intenções para um assistente de vendas no WhatsApp.
${identityBlock}

CONTEXTO DO NEGÓCIO:
${botContext}

REGRA ABSOLUTA — TÍTULOS:
Você NUNCA pode citar ou inventar um título específico de série, filme ou produto no campo "reply".
- Se o cliente pedir recomendação → use intent recommendation_request, colete preferências, e quando souber gênero+tipo, deixe o sistema buscar no catálogo real.
- Se o cliente mencionar um título → use intent title_search com candidateQuery contendo o título extraído; NÃO mencione o título no reply.
- "reply" serve apenas para perguntar preferências, confirmar entendimento ou responder dúvidas. Nunca para nomear produtos.

REGRA ABSOLUTA — DUPLICATAS:
Para title_search e partial_search: reply DEVE ser string vazia "". O catálogo responde.
Para recommendation_request com preferencesComplete=true: reply DEVE ser string vazia "". O sistema busca e responde.

INTENTS:
- ack: usuário reconhece sem pedir nada ("okay", "entendi", "vou olhar", "tá bom", "ah sim")
- title_search: menciona nome específico de série/produto com clareza suficiente para buscar
  → sempre inclua candidateQuery com o melhor título/termo extraído da mensagem
  → reply DEVE ser "" (vazio)
- partial_search: descreve série vagamente sem nome exato ("tem uma de médico", "aquela do dragão", "série de época")
  → extraia o melhor candidateQuery possível (ex: "médico", "dragão", "época")
  → reply DEVE ser "" (vazio)
- recommendation_request: cliente quer recomendação sem citar título específico
  → colete genrePreference (ação, romance, suspense, comédia, drama, fantasia...) e typePreference (k-drama, turca, brasileira, mexicana...)
  → se um dos dois ainda não foi perguntado: reply com UMA pergunta direta
  → quando você já souber ambos (do histórico ou da mensagem atual): preferencesComplete=true, reply=""
  → se o cliente recusar preferência: use o que tem + preferencesComplete=true
- catalog: quer ver opções sem nome específico ("me mostre outras", "o que tem?")
- checkout: quer fechar pedido e pagar
- payment_receipt: já fez PIX e quer enviar comprovante
- doubt: dúvida sobre funcionamento, prazo, entrega, como funciona
- returning_user: voltou após pausa longa (minutesSinceLastMessage > returningUserThreshold)
- price_issue: reclamação de preço, "muito caro", "não tenho dinheiro"
- negative_finish: quer encerrar sem comprar ("mais nada", "só isso", "não quero mais")
- unknown_noise: ruído, risada, emoji solto, tecla solta, texto acidental, mensagem sem contexto claro
- unknown_handoff: situação que exige revisão interna — reclamação explícita, problema real, cliente visivelmente irritado. Use APENAS quando há claramente um problema real descrito em palavras.

REGRA: Na dúvida entre unknown_noise e unknown_handoff, use unknown_noise.

NEXTACTIONS:
- respond_only: apenas a reply é suficiente
- search_catalog: buscar no catálogo pelo candidateQuery (usar com title_search e partial_search)
- catalog_recommendation: buscar no catálogo por gênero/tipo para recomendar (usar com recommendation_request quando preferencesComplete=true)
- show_catalog: mostrar link/lista do catálogo
- checkout: iniciar fechamento do pedido
- wait_receipt: aguardar comprovante de pagamento
- continue_previous_step: retomar o que estava sendo feito
- human_support: revisão interna necessária

MAPEAMENTO intent → nextAction:
- ack → respond_only
- title_search → search_catalog (reply sempre "")
- partial_search → search_catalog (reply sempre "")
- recommendation_request (preferencesComplete=false) → respond_only (pergunte preferência)
- recommendation_request (preferencesComplete=true) → catalog_recommendation (reply "")
- catalog → show_catalog
- checkout → checkout
- payment_receipt → wait_receipt
- doubt → respond_only
- returning_user → respond_only
- price_issue → respond_only
- negative_finish → respond_only
- unknown_noise → respond_only
- unknown_handoff → human_support`
}

function formatHistory(messages: Message[]): string {
  return messages
    .map(m => `${m.role === 'user' ? 'CLIENTE' : 'BOT'}: ${m.content}`)
    .join('\n')
}

function formatCart(items: CartItem[], totalBrl: string): string {
  if (items.length === 0) return 'vazio'
  const list = items.map(i => `- ${i.name}`).join('\n')
  return `${items.length} item(ns):\n${list}\nTotal: ${totalBrl}`
}

function alog(area: string, data: Record<string, unknown>): void {
  const parts = Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
  console.log(`[AIRouter:${area}] ${parts}`)
}

export class ContextualAIRouter {
  constructor(
    private aiService: AIGenerationService,
    private auditRepo?: PostgreSQLAIDecisionRepository,
  ) {}

  async route(ctx: RouterContext): Promise<RouterDecision> {
    const isReturning = ctx.minutesSinceLastMessage > ctx.returningUserThreshold

    const savedPrefsBlock = (ctx.savedGenrePref || ctx.savedTypePref)
      ? `\nPREFERÊNCIAS JÁ COLETADAS DO CLIENTE:\n${ctx.savedGenrePref ? `- Gênero: ${ctx.savedGenrePref}` : ''}\n${ctx.savedTypePref ? `- Tipo: ${ctx.savedTypePref}` : ''}`
      : ''

    const questionTypeBlock = ctx.lastBotQuestionType && ctx.lastBotQuestionType !== 'unknown'
      ? `\n- Tipo da última pergunta do bot: ${ctx.lastBotQuestionType} (use isso para interpretar "sim"/"não" corretamente)`
      : ''

    const userPrompt = `CONTEXTO DA CONVERSA:
- Fase atual: ${ctx.phase}
- Última mensagem do bot: "${ctx.lastBotMessage ?? '(nenhuma)'}"
- Carrinho: ${formatCart(ctx.cartItems, ctx.cartTotalBrl)}
- Pagamento PIX pendente: ${ctx.hasPendingPayment ? 'SIM' : 'não'}
- Minutos desde última mensagem: ${ctx.minutesSinceLastMessage}
- Threshold para returning_user: ${ctx.returningUserThreshold} minutos
- Usuário potencialmente retornando: ${isReturning ? 'SIM' : 'não'}${questionTypeBlock}${savedPrefsBlock}

HISTÓRICO (últimas mensagens):
${formatHistory(ctx.history.slice(-8))}

NOVA MENSAGEM DO CLIENTE: "${ctx.userMessage}"

Analise o contexto completo e retorne JSON:
{
  "intent": "<intent>",
  "reply": "<mensagem curta e calorosa — ou string vazia obrigatória para title_search/partial_search/recommendation com preferencesComplete=true>",
  "nextAction": "<nextAction>",
  "shouldResetFlow": false,
  "candidateQuery": "<apenas para title_search/partial_search: melhor termo/título extraído>",
  "genrePreference": "<apenas para recommendation_request: gênero detectado ou null>",
  "typePreference": "<apenas para recommendation_request: tipo detectado (k-drama/turca/brasileira...) ou null>",
  "preferencesComplete": "<true apenas quando souber gênero E tipo para recommendation_request>"
}`

    const t0 = Date.now()

    try {
      const result = await this.aiService.generate('claude', {
        systemPrompt: buildSystemPrompt(ctx.botContext, ctx.persona),
        promptTemplate: userPrompt,
        history: [],
        userMessage: ctx.userMessage,
        variables: {},
        temperature: 0.1,
        maxTokens: 500,
      })

      const durationMs = Date.now() - t0

      // #8 Performance / cost
      alog('perf', {
        provider: 'claude',
        durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: result.cachedTokens ?? 0,
        msg: ctx.userMessage.slice(0, 40),
      })

      const raw = result.content.trim()
      const jsonStart = raw.indexOf('{')
      const jsonEnd = raw.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) {
        console.warn('[ContextualAIRouter] no JSON found in response:', raw.slice(0, 100))
        alog('decision', { usedFallback: true, reason: 'no_json', durationMs })
        return FALLBACK_DECISION
      }

      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Partial<RouterDecision> & { confidence?: number }

      const validIntents: RouterIntent[] = [
        'ack', 'title_search', 'partial_search', 'recommendation_request',
        'catalog', 'checkout', 'payment_receipt',
        'doubt', 'returning_user', 'price_issue', 'negative_finish',
        'unknown_noise', 'unknown_handoff', 'unknown',
      ]
      const validActions: RouterNextAction[] = [
        'respond_only', 'search_catalog', 'catalog_recommendation', 'show_catalog',
        'checkout', 'wait_receipt', 'continue_previous_step', 'human_support',
      ]

      const intent = validIntents.includes(parsed.intent as RouterIntent)
        ? (parsed.intent as RouterIntent)
        : 'unknown'
      const nextAction = validActions.includes(parsed.nextAction as RouterNextAction)
        ? (parsed.nextAction as RouterNextAction)
        : 'respond_only'
      const usedFallback = intent === 'unknown' && parsed.intent !== 'unknown'

      // Enforce: title_search and partial_search must have empty reply
      const isCatalogAction = nextAction === 'search_catalog' || nextAction === 'catalog_recommendation'
      const replyEnforced = isCatalogAction ? '' : (typeof parsed.reply === 'string' ? parsed.reply : '')

      // #1 AI Router structured log
      alog('decision', {
        layer: 'ai_router',
        message: ctx.userMessage.slice(0, 80),
        phase: ctx.phase,
        lastBotQuestionType: ctx.lastBotQuestionType ?? null,
        intent,
        nextAction,
        confidence: parsed.confidence ?? null,
        candidateQuery: parsed.candidateQuery ?? null,
        genrePreference: parsed.genrePreference ?? null,
        typePreference: parsed.typePreference ?? null,
        preferencesComplete: parsed.preferencesComplete ?? false,
        usedFallback,
        durationMs,
      })

      // #4 Recommendation engine log
      if (intent === 'recommendation_request') {
        alog('recommendation', {
          layer: 'recommendation_engine',
          userPreferences: {
            genre: parsed.genrePreference ?? ctx.savedGenrePref ?? null,
            type: parsed.typePreference ?? ctx.savedTypePref ?? null,
          },
          preferencesComplete: parsed.preferencesComplete === true,
          savedGenre: ctx.savedGenrePref ?? null,
          savedType: ctx.savedTypePref ?? null,
          msg: ctx.userMessage.slice(0, 80),
        })
      }

      const decision: RouterDecision = {
        intent,
        reply: replyEnforced,
        nextAction,
        shouldResetFlow: parsed.shouldResetFlow === true,
        candidateQuery: typeof parsed.candidateQuery === 'string' ? parsed.candidateQuery : undefined,
        genrePreference: typeof parsed.genrePreference === 'string' ? parsed.genrePreference : undefined,
        typePreference: typeof parsed.typePreference === 'string' ? parsed.typePreference : undefined,
        preferencesComplete: parsed.preferencesComplete === true,
      }

      if (this.auditRepo && ctx.botId && ctx.phoneNumber) {
        this.auditRepo.save({
          botId: ctx.botId,
          conversationId: ctx.conversationId,
          phoneNumber: ctx.phoneNumber,
          layer: 'ai_router',
          inputMessage: ctx.userMessage,
          intent,
          confidence: parsed.confidence ?? undefined,
          provider: 'claude',
          durationMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          usedFallback,
          extra: {
            nextAction,
            phase: ctx.phase,
            lastBotQuestionType: ctx.lastBotQuestionType ?? null,
            candidateQuery: parsed.candidateQuery ?? null,
            genrePreference: parsed.genrePreference ?? null,
            typePreference: parsed.typePreference ?? null,
            preferencesComplete: parsed.preferencesComplete ?? false,
            cachedTokens: result.cachedTokens ?? 0,
          },
        })
      }

      return decision
    } catch (err) {
      const durationMs = Date.now() - t0
      console.error('[ContextualAIRouter] error:', err instanceof Error ? err.message : err)
      alog('decision', { usedFallback: true, reason: 'exception', error: err instanceof Error ? err.message : String(err), durationMs })
      if (this.auditRepo && ctx.botId && ctx.phoneNumber) {
        this.auditRepo.save({
          botId: ctx.botId, conversationId: ctx.conversationId, phoneNumber: ctx.phoneNumber,
          layer: 'ai_router', inputMessage: ctx.userMessage, intent: 'unknown',
          provider: 'claude', durationMs, usedFallback: true,
          extra: { error: err instanceof Error ? err.message : String(err) },
        })
      }
      return FALLBACK_DECISION
    }
  }
}
