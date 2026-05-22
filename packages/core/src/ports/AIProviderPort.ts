export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AIGenerateParams {
  systemPrompt: string
  promptTemplate: string
  history: AIMessage[]
  userMessage: string
  variables: Record<string, string>
  temperature?: number
  maxTokens?: number
  cacheSystemPrompt?: boolean
  imageBase64?: string
}

export interface AIGenerateResult {
  content: string
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
}

export interface AIProviderPort {
  generate(params: AIGenerateParams): Promise<AIGenerateResult>
  readonly providerName: string
}
