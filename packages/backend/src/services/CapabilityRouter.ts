import type { Capability, AIObservationRepository } from '@whatsbot/core'
import type { AIMessage } from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'
import type { CapabilityRepository } from '@whatsbot/core'

export interface RouterContext {
  botId: string
  conversationId: string
  phoneNumber: string
  message: string
  phase: string
  leadTags: string[]
  cartCount: number
  hasPendingPayment: boolean
  history: AIMessage[]
  hasImage: boolean
}

export interface RouterDecision {
  capability: Capability | null
  method: 'trigger' | 'ai' | 'default' | 'none'
  confidence: number
  reasoning: string
  allScores: Record<string, number>
  matchedTriggers: string[]
  durationMs: number
}

const TRIGGER_THRESHOLD = 5

export class CapabilityRouter {
  private capabilityCache: Map<string, { caps: Capability[]; cachedAt: number }> = new Map()
  private readonly CACHE_TTL_MS = 60_000

  constructor(
    private capabilityRepo: CapabilityRepository,
    private aiService: AIGenerationService,
    private observationRepo: AIObservationRepository,
  ) {}

  async route(ctx: RouterContext): Promise<RouterDecision> {
    const t0 = Date.now()

    const capabilities = await this.getCapabilities(ctx.botId)

    if (capabilities.length === 0) {
      return this.buildDecision(null, 'none', 0, 'No capabilities configured', {}, [], t0)
    }

    // Phase 1: trigger check (0ms, no AI)
    const triggerResult = this.evaluateTriggers(capabilities, ctx)

    if (triggerResult.best && triggerResult.best.score >= TRIGGER_THRESHOLD) {
      const decision = this.buildDecision(
        triggerResult.best.capability,
        'trigger',
        Math.min(triggerResult.best.score / 10, 1),
        `Trigger match: ${triggerResult.best.matchedTriggers.join(', ')}`,
        triggerResult.allScores,
        triggerResult.best.matchedTriggers,
        t0,
      )
      this.saveObservation(ctx, decision)
      return decision
    }

    // Phase 2: AI router
    const aiDecision = await this.routeWithAI(ctx, capabilities, t0)

    // Phase 3: default fallback
    if (!aiDecision.capability || aiDecision.confidence < 0.5) {
      const defaultCap = capabilities.find(c => c.isDefault)
      if (defaultCap) {
        const decision = this.buildDecision(
          defaultCap,
          'default',
          0.5,
          'Fallback to default capability',
          { ...triggerResult.allScores, ...aiDecision.allScores },
          [],
          t0,
        )
        this.saveObservation(ctx, decision)
        return decision
      }
    }

    const finalDecision: RouterDecision = {
      ...aiDecision,
      allScores: { ...triggerResult.allScores, ...aiDecision.allScores },
      durationMs: Date.now() - t0,
    }
    this.saveObservation(ctx, finalDecision)
    return finalDecision
  }

  private async getCapabilities(botId: string): Promise<Capability[]> {
    const cached = this.capabilityCache.get(botId)
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.caps
    }
    const caps = await this.capabilityRepo.findEnabledByBotId(botId)
    // Already ordered by priority DESC from DB, but sort again for safety
    caps.sort((a, b) => b.priority - a.priority)
    this.capabilityCache.set(botId, { caps, cachedAt: Date.now() })
    return caps
  }

  private evaluateTriggers(
    capabilities: Capability[],
    ctx: RouterContext,
  ): {
    best: { capability: Capability; score: number; matchedTriggers: string[] } | null
    allScores: Record<string, number>
  } {
    const allScores: Record<string, number> = {}
    let best: { capability: Capability; score: number; matchedTriggers: string[] } | null = null

    for (const cap of capabilities) {
      const result = cap.matchesTriggers({
        message: ctx.message,
        phase: ctx.phase,
        leadTags: ctx.leadTags,
      })
      allScores[cap.id] = result.score

      if (result.matches && (!best || result.score > best.score)) {
        best = { capability: cap, score: result.score, matchedTriggers: result.matchedTriggers }
      }
    }

    return { best, allScores }
  }

  private async routeWithAI(
    ctx: RouterContext,
    capabilities: Capability[],
    t0: number,
  ): Promise<RouterDecision> {
    const prompt = this.buildPrompt(ctx, capabilities)

    try {
      const result = await this.aiService.generate('groq', {
        systemPrompt: prompt.system,
        promptTemplate: prompt.user,
        history: [],
        userMessage: ctx.message,
        variables: {},
        temperature: 0.1,
        maxTokens: 300,
        cacheSystemPrompt: true,
      })

      const parsed = this.parseAIResponse(result.content)
      const selectedCap = capabilities.find(c => c.id === parsed.capabilityId) ?? null

      console.log(`[CapabilityRouter] ai decision: cap=${selectedCap?.name ?? 'null'} confidence=${parsed.confidence} reason="${parsed.reasoning}"`)

      return this.buildDecision(
        selectedCap,
        'ai',
        parsed.confidence,
        parsed.reasoning,
        parsed.scores,
        [],
        t0,
      )
    } catch (err) {
      console.error('[CapabilityRouter] AI error:', err)
      return this.buildDecision(null, 'ai', 0, 'AI error', {}, [], t0)
    }
  }

  private buildPrompt(ctx: RouterContext, capabilities: Capability[]): { system: string; user: string } {
    const capList = capabilities
      .map(cap => `### ${cap.name} (id: ${cap.id})
**Quando usar:** ${cap.description}
**Exemplos:** ${cap.examples.map(e => `"${e}"`).join(', ')}${cap.exclusions.length > 0 ? `\n**NÃO usar se:** ${cap.exclusions.map(e => `"${e}"`).join(', ')}` : ''}
**Prioridade:** ${cap.priority}`)
      .join('\n\n')

    const system = `Você é um roteador de capabilities para um bot de WhatsApp.

## Sua função
Analisar a mensagem do cliente e decidir qual capability deve ser ativada.

## Capabilities disponíveis
${capList}

## Regras
1. Analise a INTENÇÃO do cliente, não apenas palavras-chave
2. Considere o CONTEXTO (fase, carrinho, histórico)
3. Se a mensagem bater com "NÃO usar se", descarte essa capability
4. Se duas capabilities parecem válidas, escolha a de maior prioridade
5. Se nenhuma capability claramente se aplica, retorne null com baixa confiança

## Formato de resposta (JSON apenas, sem texto fora)
{"capabilityId":"uuid-ou-null","confidence":0.0,"reasoning":"explicação curta","scores":{"cap_id":0.0}}`

    const historyText = ctx.history
      .slice(-5)
      .map(m => `${m.role === 'user' ? 'CLIENTE' : 'BOT'}: ${m.content}`)
      .join('\n')

    const user = `## Contexto atual
- Fase: ${ctx.phase}
- Carrinho: ${ctx.cartCount} item(s)
- Pagamento pendente: ${ctx.hasPendingPayment ? 'SIM' : 'não'}
- Tags do lead: ${ctx.leadTags.join(', ') || 'nenhuma'}
- Tem imagem: ${ctx.hasImage ? 'SIM' : 'não'}

## Histórico recente
${historyText || '(sem histórico)'}

## Mensagem do cliente
"${ctx.message}"

Responda apenas com JSON:`

    return { system, user }
  }

  private parseAIResponse(content: string): {
    capabilityId: string | null
    confidence: number
    reasoning: string
    scores: Record<string, number>
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found')
      const parsed = JSON.parse(jsonMatch[0])
      return {
        capabilityId: parsed.capabilityId || null,
        confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
        reasoning: parsed.reasoning || '',
        scores: parsed.scores || {},
      }
    } catch {
      return { capabilityId: null, confidence: 0, reasoning: 'Parse error', scores: {} }
    }
  }

  private buildDecision(
    capability: Capability | null,
    method: RouterDecision['method'],
    confidence: number,
    reasoning: string,
    allScores: Record<string, number>,
    matchedTriggers: string[],
    startTime: number,
  ): RouterDecision {
    return { capability, method, confidence, reasoning, allScores, matchedTriggers, durationMs: Date.now() - startTime }
  }

  private saveObservation(ctx: RouterContext, decision: RouterDecision): void {
    // Non-blocking — never break the main flow
    this.observationRepo.save({
      botId: ctx.botId,
      conversationId: ctx.conversationId,
      phoneNumber: ctx.phoneNumber,
      userMessage: ctx.message,
      hasImage: ctx.hasImage,
      phase: ctx.phase,
      cartCount: ctx.cartCount,
      leadTags: ctx.leadTags,
      historyLength: ctx.history.length,
      layer: 'capability_router',
      selectedCapabilityId: decision.capability?.id,
      selectedCapabilityName: decision.capability?.name,
      method: decision.method,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      allScores: decision.allScores,
      matchedTriggers: decision.matchedTriggers,
      durationMs: decision.durationMs,
    }).catch(err => console.error('[CapabilityRouter] Failed to save observation:', err))
  }

  invalidateCache(botId: string): void {
    this.capabilityCache.delete(botId)
  }
}
