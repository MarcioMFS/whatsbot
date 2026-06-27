import { useAuthStore } from '../stores/authStore.ts'

const BASE = '/api'

// Módulo resolvido por bot (GET /bots/:id/modules) — def do registro + estado + config.
export interface BotModule {
  id: string
  name: string
  type: 'routable' | 'tool' | 'effect'
  description: string
  toolNames?: string[]
  effectOn?: string
  dependsOn?: string[]
  policyKeys?: string[]
  defaultEnabled?: boolean
  enabled: boolean
  config: Record<string, unknown>
}

// Trilha do agente — um passo (tool/reply/nudge/error) com input/resultado.
export interface AgentTraceEntry {
  conversationId: string | null
  phoneNumber: string
  turnMessage: string | null
  step: number
  kind: 'tool' | 'reply' | 'error' | 'nudge'
  toolName: string | null
  toolInput: Record<string, unknown> | null
  resultCode: string | null
  resultSuccess: boolean | null
  text: string | null
  stopReason: string | null
  provider: string | null
  latencyMs: number | null
  occurredAt: string
}

// Segmento descrito de um flow (Habilidade) — agrupa nós sob {nome, descrição, quando usar}.
export interface FlowSegment {
  id: string
  name: string
  description: string
  whenToUse?: string
  nodeIds: string[]
  generated?: boolean
  escapeMode?: 'inherit' | 'off' | 'cover' | 'handoff'
  escapeHint?: string
}

// Proposta do Builder/Improver — IA propõe (não aplica) até aprovação humana.
export interface FlowProposal {
  id: string
  botId: string
  flowId: string | null
  kind: string
  targetRuntime: string | null
  proposedContent: Record<string, unknown>
  status: 'pending' | 'approved' | 'applied' | 'rejected' | 'stale'
  createdBy: string
  reviewedBy: string | null
  createdAt: string
  reviewedAt: string | null
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = '/login'
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error ?? 'Request failed')
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

// Painel evolutivo — funil (F1), padrões (F2), performance por versão (F4).
export interface FunnelStage { stage: string; order: number; count: number; convFromPrev: number | null }
export interface FunnelResult {
  windowDays: number
  conversations: number
  botsContributing: number
  stages: FunnelStage[]
  outcomes: { paid: number; abandoned: number; escalated: number; timeout: number; completed: number }
  gmvCentavos: number
}
export interface WinningPattern { id: string; field: string; bucket: string; guidance: string; sampleTextAnon: string | null; status: string }
export interface VersionPerf { patternSetVersion: string; total: number; bots: number; conversions: number; convRate: number; wilsonLower: number; lift: number }

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: { id: string; email: string; name: string } }>(
        '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }
      ),
    register: (email: string, password: string, name: string) =>
      request<{ token: string; user: { id: string; email: string; name: string } }>(
        '/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }
      ),
  },
  ai: {
    generateBotConfig: (description: string, language: string, provider: string) =>
      request<unknown>('/ai/generate-bot-config', {
        method: 'POST',
        body: JSON.stringify({ description, language, provider }),
      }),
  },
  bots: {
    list: () => request<unknown[]>('/bots'),
    get: (id: string) => request<unknown>(`/bots/${id}`),
    create: (data: unknown) => request<unknown>('/bots', { method: 'POST', body: JSON.stringify(data) }),
    activate: (id: string, flowId: string) =>
      request<unknown>(`/bots/${id}/activate`, { method: 'PATCH', body: JSON.stringify({ flowId }) }),
    deactivate: (id: string) =>
      request<unknown>(`/bots/${id}/deactivate`, { method: 'PATCH', body: '{}' }),
    qrcode: (id: string) => request<{ qrCode: string }>(`/bots/${id}/qrcode`),
    connectionStatus: (id: string) => request<{ state: string }>(`/bots/${id}/connection-status`),
    delete: (id: string) => request<void>(`/bots/${id}`, { method: 'DELETE' }),
    updateRoutingRules: (id: string, rules: { tag: string; flowId: string }[]) =>
      request<unknown>(`/bots/${id}/routing-rules`, { method: 'PATCH', body: JSON.stringify({ rules }) }),
    updateConfig: (id: string, config: Record<string, unknown>) =>
      request<unknown>(`/bots/${id}/config`, { method: 'PATCH', body: JSON.stringify(config) }),
    // Centro de Controle: save validado (persona preview + invalida cache)
    updateGlobalConfig: (id: string, config: Record<string, unknown>) =>
      request<{ config: Record<string, unknown>; preview: unknown }>(
        `/bots/${id}/global-config`, { method: 'PATCH', body: JSON.stringify(config) }
      ),
    modules: (id: string) =>
      request<{ modules: BotModule[] }>(`/bots/${id}/modules`),
    events: (id: string, limit?: number) =>
      request<{ events: unknown[] }>(`/bots/${id}/events${limit ? `?limit=${limit}` : ''}`),
    agentTrace: (id: string, limit = 150) =>
      request<{ trace: AgentTraceEntry[] }>(`/bots/${id}/agent-trace?limit=${limit}`),
  },
  flows: {
    list: (botId: string) => request<unknown[]>(`/flows/bot/${botId}`),
    create: (botId: string, data: unknown) =>
      request<unknown>(`/flows/bot/${botId}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      request<unknown>(`/flows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/flows/${id}`, { method: 'DELETE' }),
    // Segmentos descritos (Habilidades) — ver Brain/spec_skills_segmentos.md
    segments: (flowId: string) =>
      request<{ segments: FlowSegment[] }>(`/flows/${flowId}/segments`),
    generateSegments: (flowId: string) =>
      request<{ segments: FlowSegment[] }>(`/flows/${flowId}/segments/generate`, { method: 'POST', body: '{}' }),
    saveSegments: (flowId: string, segments: FlowSegment[]) =>
      request<{ segments: FlowSegment[] }>(`/flows/${flowId}/segments`, { method: 'PUT', body: JSON.stringify({ segments }) }),
  },
  conversations: {
    list: (botId: string, limit?: number) =>
      request<unknown[]>(`/conversations/bot/${botId}${limit ? `?limit=${limit}` : ''}`),
  },
  leads: {
    list: (botId: string, tag?: string) =>
      request<{ leads: unknown[]; total: number }>(
        `/leads/bot/${botId}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`
      ),
    updateTags: (botId: string, phone: string, body: { add?: string[]; remove?: string[] }) =>
      request<unknown>(`/leads/bot/${botId}/phone/${encodeURIComponent(phone)}/tags`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },
  products: {
    list: (botId: string, includeUnavailable = false) =>
      request<unknown[]>(`/products/bot/${botId}${includeUnavailable ? '?includeUnavailable=true' : ''}`),
    get: (id: string) => request<unknown>(`/products/${id}`),
    create: (botId: string, data: unknown) =>
      request<unknown>(`/products/bot/${botId}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      request<unknown>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/products/${id}`, { method: 'DELETE' }),
  },
  orders: {
    list: (botId: string, limit?: number) =>
      request<unknown[]>(`/orders/bot/${botId}${limit ? `?limit=${limit}` : ''}`),
    get: (id: string) => request<unknown>(`/orders/${id}`),
  },
  handoffs: {
    list: (botId: string, status?: string) =>
      request<{ handoffs: unknown[]; total: number; limit: number; offset: number }>(
        `/handoffs/bot/${botId}${status ? `?status=${status}` : ''}`
      ),
    get: (id: string) => request<unknown>(`/handoffs/${id}`),
    updateStatus: (id: string, status: string, resolvedBy?: string) =>
      request<unknown>(`/handoffs/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, resolvedBy }),
      }),
  },
  paymentIntents: {
    list: (botId: string, status?: string) =>
      request<unknown[]>(`/payment-intents/bot/${botId}${status ? `?status=${status}` : ''}`),
    cancel: (id: string) =>
      request<unknown>(`/payment-intents/${id}/cancel`, { method: 'PATCH', body: '{}' }),
  },
  packageOffers: {
    list: (botId: string, includeInactive = false) =>
      request<unknown[]>(`/package-offers/bot/${botId}${includeInactive ? '?includeInactive=true' : ''}`),
    create: (botId: string, data: unknown) =>
      request<unknown>(`/package-offers/bot/${botId}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      request<unknown>(`/package-offers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    toggle: (id: string) =>
      request<unknown>(`/package-offers/${id}/toggle`, { method: 'PATCH', body: '{}' }),
    delete: (id: string) =>
      request<void>(`/package-offers/${id}`, { method: 'DELETE' }),
  },
  observations: {
    stats: (botId: string, days = 7) =>
      request<{ stats: unknown }>(`/observations/bot/${botId}/stats?days=${days}`),
    problematic: (botId: string, days = 7) =>
      request<{ observations: unknown[] }>(`/observations/bot/${botId}/problematic?days=${days}`),
    feed: (botId: string, limit = 100) =>
      request<{ observations: unknown[] }>(`/observations/bot/${botId}?limit=${limit}`),
    setOutcome: (id: string, outcome: string, reason?: string) =>
      request<void>(`/observations/${id}/outcome`, {
        method: 'PATCH',
        body: JSON.stringify({ outcome, reason }),
      }),
  },
  // Builder/Improver — fila de propostas da IA (gate humano).
  proposals: {
    list: (botId: string, status?: string) =>
      request<{ proposals: FlowProposal[] }>(`/proposals/bot/${botId}${status ? `?status=${status}` : ''}`),
    generate: (botId: string, flowId: string, kind = 'generate_segments') =>
      request<FlowProposal>('/proposals/generate', { method: 'POST', body: JSON.stringify({ botId, flowId, kind }) }),
    // Gera um FLUXO NOVO inteiro a partir da descrição do negócio (gabarito determinístico, IA free).
    generateFlow: (botId: string, businessDescription: string) =>
      request<FlowProposal>('/proposals/generate', { method: 'POST', body: JSON.stringify({ botId, kind: 'generate_flow', businessDescription }) }),
    improve: (botId: string, days?: number) =>
      request<FlowProposal | { proposal: null; reason?: string }>('/proposals/improve', { method: 'POST', body: JSON.stringify({ botId, days }) }),
    approve: (id: string) =>
      request<{ ok: boolean; applied?: string; snapshotVersion?: number; flowId?: string }>(`/proposals/${id}/approve`, { method: 'POST', body: '{}' }),
    reject: (id: string) =>
      request<{ ok: boolean }>(`/proposals/${id}/reject`, { method: 'POST', body: '{}' }),
  },
  // Painel evolutivo (read-only): funil de conversão, store de padrões, performance por versão.
  metrics: {
    funnel: (botId: string, days = 30) =>
      request<{ bot: FunnelResult; global: FunnelResult | null; globalSuppressed: boolean }>(`/metrics/funnel/${botId}?days=${days}`),
    patterns: (vertical?: string) =>
      request<{ patterns: Record<string, WinningPattern[]> }>(`/metrics/patterns${vertical ? `?vertical=${encodeURIComponent(vertical)}` : ''}`),
    performance: (days = 90) =>
      request<{ baseline: number; versions: VersionPerf[] }>(`/metrics/performance?days=${days}`),
    audit: (botId: string) =>
      request<{ flows: Array<{ flowId: string; flowName: string; patternSetVersion: string; patterns: Array<{ field: string; bucket: string; status: string }> }> }>(`/metrics/audit/${botId}`),
  },
}
