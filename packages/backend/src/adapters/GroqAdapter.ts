import Groq from 'groq-sdk'
import type { AIProviderPort, AIGenerateParams, AIGenerateResult } from '@whatsbot/core'

export class GroqAdapter implements AIProviderPort {
  readonly providerName = 'groq'
  private client: Groq

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey })
  }

  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    const userPrompt = this.buildUserPrompt(params)

    const response = await this.client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.7,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: userPrompt },
      ],
    })

    const choice = response.choices[0]
    if (!choice?.message.content) throw new Error('Empty response from Groq')

    return {
      content: choice.message.content,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    }
  }

  private buildUserPrompt(params: AIGenerateParams): string {
    let prompt = params.promptTemplate
    for (const [key, value] of Object.entries(params.variables)) {
      prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value)
    }
    if (prompt.includes('{{user_message}}')) {
      return prompt.replace('{{user_message}}', params.userMessage)
    }
    return `${prompt}\n\nUser: ${params.userMessage}`
  }
}
