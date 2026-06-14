import { getGoogleAccessToken } from './googleAuth.js'
import type { IAgentProvider, CompleteRequest, ProviderResponse, AgentMessage, ToolCall } from './types.js'

// Gemini via Vertex AI REST (generateContent). Ported pattern from Vox. No SDK.
// Config via env, defaults to the same GCP project Vox uses.

const PROJECT = process.env.GEMINI_PROJECT ?? 'project-758ade05-7be9-470b-b5d'
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const LOCATION = process.env.GEMINI_LOCATION ?? 'us-central1'

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

function toContents(messages: AgentMessage[]): GeminiContent[] {
  const out: GeminiContent[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const parts: GeminiPart[] = [{ text: m.text }]
      for (const img of m.images ?? []) parts.push({ inline_data: { mime_type: img.mimeType, data: img.dataBase64 } })
      out.push({ role: 'user', parts })
    } else if (m.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (m.text) parts.push({ text: m.text })
      for (const tc of m.toolCalls ?? []) parts.push({ functionCall: { name: tc.name, args: tc.input } })
      if (parts.length) out.push({ role: 'model', parts })
    } else {
      // tool results → user turn with functionResponse parts (Gemini convention)
      out.push({
        role: 'user',
        parts: m.results.map(r => ({
          functionResponse: {
            name: r.name,
            response: (r.output && typeof r.output === 'object') ? r.output as Record<string, unknown> : { result: r.output },
          },
        })),
      })
    }
  }
  return out
}

export class GeminiProvider implements IAgentProvider {
  readonly name = 'gemini'
  readonly supportsVision = true   // multimodal nativo (Vertex) — lê o print direto, sem pré-extração

  async complete(req: CompleteRequest): Promise<ProviderResponse> {
    const token = await getGoogleAccessToken()
    if (!token) throw new Error('Gemini auth failed — check GOOGLE_SA_PATH / sa.json')

    const geminiTools = req.tools.length
      ? [{ function_declarations: req.tools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema })) }]
      : []

    const body = {
      system_instruction: { parts: [{ text: req.system }] },
      contents: toContents(req.messages),
      ...(geminiTools.length ? { tools: geminiTools } : {}),
      generation_config: { max_output_tokens: req.maxTokens ?? 1024, temperature: req.temperature ?? 0.7 },
    }

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`
    const ctrl = new AbortController()
    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 25000)
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error(`Gemini timeout após ${timeoutMs}ms`)
      throw e
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const cand = json.candidates?.[0]
    const parts = cand?.content?.parts ?? []

    let text = ''
    const toolCalls: ToolCall[] = []
    for (const p of parts) {
      if ('text' in p && p.text) text += p.text
      if ('functionCall' in p && p.functionCall) {
        toolCalls.push({
          id: `gemini_${Date.now()}_${p.functionCall.name}`,
          name: p.functionCall.name,
          input: p.functionCall.args ?? {},
        })
      }
    }

    return {
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
      text: text || undefined,
      toolCalls,
      usage: { inputTokens: json.usageMetadata?.promptTokenCount, outputTokens: json.usageMetadata?.candidatesTokenCount },
    }
  }
}
