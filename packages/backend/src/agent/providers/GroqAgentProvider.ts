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
        return {
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
          text: msg?.content ?? undefined,
          toolCalls,
          usage: { inputTokens: resp.usage?.prompt_tokens, outputTokens: resp.usage?.completion_tokens },
        }
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status
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
