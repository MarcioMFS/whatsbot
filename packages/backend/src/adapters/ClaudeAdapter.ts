import Anthropic from '@anthropic-ai/sdk'
import type { AIProviderPort, AIGenerateParams, AIGenerateResult } from '@whatsbot/core'

export class ClaudeAdapter implements AIProviderPort {
  readonly providerName = 'claude'
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    const userPrompt = this.buildUserPrompt(params)

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.7,
      system: [
        {
          type: 'text',
          text: params.systemPrompt,
          // Cache the system prompt — only changes when bot config changes
          ...(params.cacheSystemPrompt ? { cache_control: { type: 'ephemeral' } } : {}),
        },
      ],
      messages: [
        ...params.history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: userPrompt },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

    return {
      content: content.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
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
