import Groq from 'groq-sdk'
import type { IAgentProvider, CompleteRequest, ProviderResponse, AgentMessage, ToolCall } from './types.js'

// Groq (OpenAI-compatible) como provider do agente — tool-calling via llama-3.3-70b.
// Sem visão: o modelo é texto, então imagens em AgentMessage são ignoradas (a tool de
// comprovante usa Claude separadamente; a visão de catálogo fica indisponível com Groq).
const MODEL = process.env.GROQ_AGENT_MODEL ?? 'llama-3.3-70b-versatile'

type OpenAITool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
type OpenAIToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
type OpenAIMsg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s || '{}') } catch { return {} }
}

// Groq/llama às vezes emite a tool-call em sintaxe quebrada (`<function=nome{json}</function>`)
// e a API responde 400 tool_use_failed com o texto bruto em `failed_generation`.
// Recuperamos a intenção parseando o nome + JSON — evita escalar pra humano por um glitch do modelo.
function recoverToolCalls(err: unknown): ToolCall[] | null {
  const e = err as { error?: { code?: string; failed_generation?: string }; message?: string }
  let code = e?.error?.code
  let gen = e?.error?.failed_generation
  // Fallback robusto: o SDK às vezes só traz o corpo JSON dentro de err.message ("400 {...}").
  // Parsear o JSON desescapa as aspas corretamente (regex no texto cru trunca no \").
  if (!gen && typeof e?.message === 'string') {
    const i = e.message.indexOf('{')
    if (i !== -1) {
      try {
        const body = JSON.parse(e.message.slice(i)) as { error?: { code?: string; failed_generation?: string } }
        code = body?.error?.code ?? code
        gen = body?.error?.failed_generation
      } catch { /* corpo não-JSON — ignora */ }
    }
  }
  if (code !== 'tool_use_failed' || !gen) return null
  const calls: ToolCall[] = []
  const re = /<function=([a-zA-Z_]\w*)\s*(\{[\s\S]*?\})\s*(?:<\/function>|$)/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(gen)) !== null) {
    try { calls.push({ id: `recovered_${calls.length}`, name: mm[1], input: JSON.parse(mm[2]) }) } catch { /* ignora call não-parseável */ }
  }
  return calls.length ? calls : null
}

// Llama às vezes emite a tool-call como TEXTO na resposta de sucesso (`<function=nome{json}</function>`)
// em vez de usar o campo tool_calls. Extraímos as calls e removemos do texto visível ao cliente.
function extractInlineToolCalls(text: string): { calls: ToolCall[]; clean: string } {
  const re = /<function=([a-zA-Z_]\w*)\s*(\{[\s\S]*?\})\s*(?:<\/function>|$)/g
  const calls: ToolCall[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    try { calls.push({ id: `inline_${calls.length}`, name: m[1], input: JSON.parse(m[2]) }) } catch { /* ignora */ }
  }
  const clean = text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim()
  return { calls, clean }
}

function toOpenAIMessages(system: string, messages: AgentMessage[]): OpenAIMsg[] {
  const out: OpenAIMsg[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text })
    } else if (m.role === 'assistant') {
      const tc = (m.toolCalls ?? []).map((c): OpenAIToolCall => ({
        id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) },
      }))
      out.push({ role: 'assistant', content: m.text ?? '', ...(tc.length ? { tool_calls: tc } : {}) })
    } else {
      // tool results → uma mensagem 'tool' por resultado (convenção OpenAI)
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.toolCallId, content: typeof r.output === 'string' ? r.output : JSON.stringify(r.output) })
      }
    }
  }
  return out
}

export class GroqAgentProvider implements IAgentProvider {
  readonly name = 'groq'
  readonly supportsVision = false   // llama-3.3-70b é texto-só → AgentRuntime pré-extrai títulos com Claude
  private clients: Groq[]
  private idx = 0

  constructor(apiKeys: string | string[]) {
    const keys = (Array.isArray(apiKeys) ? apiKeys : [apiKeys]).filter(Boolean)
    if (!keys.length) throw new Error('GroqAgentProvider: no API keys')
    this.clients = keys.map(k => new Groq({ apiKey: k }))
  }

  async complete(req: CompleteRequest): Promise<ProviderResponse> {
    const messages = toOpenAIMessages(req.system, req.messages)
    const tools: OpenAITool[] = req.tools.map(t => ({
      type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }))

    let lastErr: unknown
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const client = this.clients[this.idx]
      try {
        const resp = await client.chat.completions.create({
          model: MODEL,
          max_tokens: req.maxTokens ?? 1024,
          temperature: req.temperature ?? 0.7,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: messages as any,
          ...(tools.length ? { tools: tools as any, tool_choice: 'auto' as const } : {}),
        })
        const msg = resp.choices[0]?.message
        const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map(tc => ({
          id: tc.id,
          name: tc.function.name,
          input: safeParse(tc.function.arguments),
        }))
        let text = msg?.content ?? undefined
        // Fallback: tool-call emitida como texto (sem usar tool_calls) → extrai e limpa
        if (toolCalls.length === 0 && text && text.includes('<function=')) {
          const { calls, clean } = extractInlineToolCalls(text)
          if (calls.length) {
            toolCalls.push(...calls)
            text = clean || undefined
          }
        }
        return {
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
          text,
          toolCalls,
          usage: { inputTokens: resp.usage?.prompt_tokens, outputTokens: resp.usage?.completion_tokens },
        }
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status
        // tool-call malformada do llama → recupera a intenção em vez de escalar
        const recovered = status === 400 ? recoverToolCalls(err) : null
        if (recovered) {
          console.warn(`[GroqAgentProvider] tool_use_failed → recuperado: ${recovered.map(c => c.name).join(',')}`)
          return { stopReason: 'tool_use', text: undefined, toolCalls: recovered, usage: {} }
        }
        if (status === 429 || status === 503) {
          console.warn(`[GroqAgentProvider] key[${this.idx}] ${status} — rotating`)
          this.idx = (this.idx + 1) % this.clients.length
          lastErr = err
        } else {
          throw err
        }
      }
    }
    throw lastErr ?? new Error('All Groq keys exhausted')
  }
}
