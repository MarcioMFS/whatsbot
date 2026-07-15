import type { AIProviderPort, AIGenerateParams, AIGenerateResult } from '@whatsbot/core'
import { getGoogleAccessToken } from '../agent/providers/googleAuth.js'

// Gemini (Vertex AI generateContent) como provider do motor de geração (flows/ai_response,
// classify, etc.) — mesma auth/projeto do GeminiProvider do agente, mas no contrato
// AIProviderPort. Provider PADRÃO do runtime (fallback: groq — ver AIGenerationService).
const PROJECT = process.env.GEMINI_PROJECT ?? ''
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const LOCATION = process.env.GEMINI_LOCATION ?? 'us-central1'

export class GeminiAdapter implements AIProviderPort {
  readonly providerName = 'gemini'

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

  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    if (!PROJECT) throw new Error('GEMINI_PROJECT não configurado')
    const token = await getGoogleAccessToken()
    if (!token) throw new Error('Gemini auth failed — check GOOGLE_SA_PATH / sa.json')

    const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [
      ...params.history.map(m => ({
        role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: m.content }],
      })),
      {
        role: 'user' as const,
        parts: [
          { text: this.buildUserPrompt(params) },
          ...(params.imageBase64
            ? [{ inline_data: { mime_type: 'image/jpeg', data: params.imageBase64 } }]
            : []),
        ],
      },
    ]

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.systemPrompt }] },
        contents,
        generationConfig: {
          temperature: params.temperature ?? 0.7,
          maxOutputTokens: params.maxTokens ?? 1024,
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const content = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
    if (!content) throw new Error('Empty response from Gemini')
    return {
      content,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    }
  }
}
