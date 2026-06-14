// ──────────────────────────────────────────────────────────────────────────────
// Provider-agnostic agent types. The Agent Runtime never couples to a vendor —
// it talks to IAgentProvider. First impl: Gemini (Vertex). Groq = dev/fallback.
// ──────────────────────────────────────────────────────────────────────────────

/** A tool the model can call — neutral shape, adapted per provider. */
export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown> // JSON Schema (object)
}

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** Result of one executed tool, fed back to the model. */
export interface ToolResultMsg {
  toolCallId: string
  name: string
  output: unknown
}

/** An image attached to a user turn (multimodal vision). */
export interface AgentImage {
  mimeType: string
  dataBase64: string
}

/** Neutral conversation turn. Providers convert to/from their native format. */
export type AgentMessage =
  | { role: 'user'; text: string; images?: AgentImage[] }
  | { role: 'assistant'; text?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; results: ToolResultMsg[] }

export interface ProviderResponse {
  stopReason: 'tool_use' | 'end'
  text?: string
  toolCalls: ToolCall[]
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface CompleteRequest {
  system: string
  messages: AgentMessage[]
  tools: ToolDef[]
  maxTokens?: number
  temperature?: number
}

export interface IAgentProvider {
  readonly name: string
  complete(req: CompleteRequest): Promise<ProviderResponse>
}
