import type { AIProviderPort, AIGenerateParams, AIGenerateResult } from '@whatsbot/core'

type Providers = { claude: AIProviderPort | null; groq: AIProviderPort | null }

export class AIGenerationService {
  constructor(private providers: Providers) {}

  async generate(
    providerName: 'claude' | 'groq',
    params: AIGenerateParams,
  ): Promise<AIGenerateResult> {
    const provider = this.providers[providerName]
    if (!provider) throw new Error(`AI provider "${providerName}" is not configured`)
    return provider.generate(params)
  }

  getAvailableProviders(): string[] {
    return Object.entries(this.providers)
      .filter(([, v]) => v !== null)
      .map(([k]) => k)
  }
}
