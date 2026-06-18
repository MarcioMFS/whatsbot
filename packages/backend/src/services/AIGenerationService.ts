import type { AIProviderPort, AIGenerateParams, AIGenerateResult } from '@whatsbot/core'

type Providers = { claude: AIProviderPort | null; groq: AIProviderPort | null; nvidia: AIProviderPort | null }

export type ProviderName = 'claude' | 'groq' | 'nvidia'

// #budget: cadeia FIXA do BUILDER (geração/sugestão offline). NUNCA inclui 'claude' (pago) nem o
// Gemini do runtime — garante que o Builder não queima budget. Ordem = preferência (free primeiro).
export const BUILDER_CHAIN: ProviderName[] = ['nvidia', 'groq']

export class AIGenerationService {
  constructor(private providers: Providers) {}

  async generate(
    providerName: ProviderName,
    params: AIGenerateParams,
  ): Promise<AIGenerateResult> {
    const provider = this.providers[providerName]
    if (!provider) throw new Error(`AI provider "${providerName}" is not configured`)
    return provider.generate(params)
  }

  /**
   * Geração do plano BUILDER/IMPROVER — roda na cadeia free (NVIDIA → Groq), NUNCA num provider pago.
   * Tenta cada provider configurado da BUILDER_CHAIN em ordem; só cai pro próximo em erro.
   */
  async generateBuilder(params: AIGenerateParams): Promise<AIGenerateResult> {
    let lastError: unknown
    const tried: string[] = []
    for (const name of BUILDER_CHAIN) {
      const provider = this.providers[name]
      if (!provider) continue
      tried.push(name)
      try {
        return await provider.generate(params)
      } catch (err) {
        console.warn(`[AIGenerationService] builder provider "${name}" falhou, próximo:`, err instanceof Error ? err.message : err)
        lastError = err
      }
    }
    throw lastError ?? new Error(`Nenhum provider do BUILDER_CHAIN configurado (tentados: ${tried.join(',') || 'nenhum'})`)
  }

  getAvailableProviders(): string[] {
    return Object.entries(this.providers)
      .filter(([, v]) => v !== null)
      .map(([k]) => k)
  }
}
