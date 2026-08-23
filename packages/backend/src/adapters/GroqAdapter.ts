import Groq from 'groq-sdk'
import type { AIProviderPort, AIGenerateParams, AIGenerateResult } from '@whatsbot/core'

// A Groq aposentou o llama-3.3-70b-versatile: a API passou a responder 404 model_not_found,
// derrubando a geração de bot ("Criar seu bot" → Groq) e o agente de todo bot com provider groq.
// Substituto validado em 2026-08-23 contra a API real: gpt-oss-120b passou em JSON estruturado
// (1,2s) e em tool-calling (0,3s); qwen3.6-27b devolveu JSON inválido e foi descartado.
const DEFAULT_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'

export class GroqAdapter implements AIProviderPort {
  readonly providerName = 'groq'
  private clients: Groq[]
  private currentIndex = 0

  constructor(apiKeys: string | string[]) {
    const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys]
    this.clients = keys.map(k => new Groq({ apiKey: k }))
  }

  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    const userPrompt = this.buildUserPrompt(params)
    const messages = [
      { role: 'system' as const, content: params.systemPrompt },
      ...params.history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userPrompt },
    ]

    let lastError: unknown
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const client = this.clients[this.currentIndex]
      try {
        const response = await client.chat.completions.create({
          model: DEFAULT_MODEL,
          max_tokens: params.maxTokens ?? 1024,
          temperature: params.temperature ?? 0.7,
          messages,
        })
        const choice = response.choices[0]
        if (!choice?.message.content) throw new Error('Empty response from Groq')
        return {
          content: choice.message.content,
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        }
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status
        if (status === 429 || status === 503) {
          console.warn(`[GroqAdapter] key[${this.currentIndex}] rate limited (${status}), rotating`)
          this.currentIndex = (this.currentIndex + 1) % this.clients.length
          lastError = err
        } else {
          throw err
        }
      }
    }
    throw lastError ?? new Error('All Groq keys exhausted')
  }

  private buildUserPrompt(params: AIGenerateParams): string {
    // promptTemplate é OPCIONAL (nó ai_response só com systemPrompt): sem template, a
    // mensagem do usuário vai crua — antes `.replace` em undefined derrubava TODA
    // chamada do nó (IA 100% muda em prod, caindo no edge de erro; 2026-07-18).
    let prompt = params.promptTemplate ?? ''
    for (const [key, value] of Object.entries(params.variables ?? {})) {
      prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value)
    }
    if (!prompt.trim()) return params.userMessage
    if (prompt.includes('{{user_message}}')) {
      return prompt.replace('{{user_message}}', params.userMessage)
    }
    return `${prompt}\n\nUser: ${params.userMessage}`
  }
}
