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
    const model = params.imageBase64 ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6'

    const lastUserContent: Anthropic.MessageParam['content'] = params.imageBase64
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: params.imageBase64 } },
          { type: 'text', text: userPrompt },
        ]
      : userPrompt

    const response = await this.client.messages.create({
      model,
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.7,
      system: [
        {
          type: 'text',
          text: params.systemPrompt,
          ...(params.cacheSystemPrompt ? { cache_control: { type: 'ephemeral' } } : {}),
        },
      ],
      messages: [
        ...params.history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: lastUserContent },
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
