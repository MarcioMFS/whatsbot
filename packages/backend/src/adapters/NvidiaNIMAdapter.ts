import type { AIProviderPort, AIGenerateParams, AIGenerateResult } from '@whatsbot/core'

// NVIDIA NIM (build.nvidia.com) — endpoint free, OpenAI-compatible. Usado pelo plano BUILDER/IMPROVER
// (gerar/sugerir offline), preservando o budget do Gemini do runtime. Sem SDK: fetch direto.
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1'
// nemotron-3-super: modelo de RACIOCÍNIO (emite reasoning_content separado do content). Para geração
// estruturada deixamos o "thinking" desligado por padrão → resposta limpa, mais rápida, menos tokens.
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b'

export class NvidiaNIMAdapter implements AIProviderPort {
  readonly providerName = 'nvidia'

  constructor(
    private apiKey: string,
    private model: string = DEFAULT_MODEL,
    private enableThinking: boolean = false,
  ) {}

  async generate(params: AIGenerateParams): Promise<AIGenerateResult> {
    if (!this.apiKey) throw new Error('NVIDIA_API_KEY ausente — NvidiaNIMAdapter não configurado')

    const userPrompt = this.buildUserPrompt(params)
    const messages = [
      { role: 'system', content: params.systemPrompt },
      ...params.history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userPrompt },
    ]

    // Builder roda offline/async — tolera latência alta do modelo de raciocínio.
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 120_000)
    try {
      const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: params.temperature ?? 0.3,
          // reasoning consome tokens; default generoso p/ não cortar a resposta estruturada.
          max_tokens: params.maxTokens ?? 4096,
          // extra_body do SDK = campos top-level no REST. Desliga o thinking p/ saída limpa.
          chat_template_kwargs: { enable_thinking: this.enableThinking },
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`NVIDIA NIM ${res.status}: ${body.slice(0, 300)}`)
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = data.choices?.[0]?.message?.content?.trim()
      if (!content) {
        // Se o thinking consumiu todo o orçamento e não sobrou content, sinaliza claro (não retorna vazio silencioso).
        throw new Error('NVIDIA NIM: resposta sem content (verifique max_tokens vs enable_thinking)')
      }
      return {
        content,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      }
    } finally {
      clearTimeout(timer)
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
    return params.userMessage ? `${prompt}\n\nUser: ${params.userMessage}` : prompt
  }
}
