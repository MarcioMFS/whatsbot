import { useAuthStore } from '../stores/authStore.ts'

const BASE = '/api'

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
    events: (id: string, limit?: number) =>
      request<{ events: unknown[] }>(`/bots/${id}/events${limit ? `?limit=${limit}` : ''}`),
  },
  flows: {
    list: (botId: string) => request<unknown[]>(`/flows/bot/${botId}`),
    create: (botId: string, data: unknown) =>
      request<unknown>(`/flows/bot/${botId}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      request<unknown>(`/flows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/flows/${id}`, { method: 'DELETE' }),
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
  capabilities: {
    list: (botId: string) =>
      request<unknown[]>(`/capabilities/bot/${botId}`),
    get: (id: string) =>
      request<unknown>(`/capabilities/${id}`),
    create: (botId: string, data: unknown) =>
      request<unknown>(`/capabilities/bot/${botId}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      request<unknown>(`/capabilities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/capabilities/${id}`, { method: 'DELETE' }),
    toggle: (id: string) =>
      request<unknown>(`/capabilities/${id}/toggle`, { method: 'PATCH', body: '{}' }),
    metrics: (botId: string, days = 7) =>
      request<unknown[]>(`/capabilities/bot/${botId}/metrics?days=${days}`),
    patterns: (botId: string, days = 7) =>
      request<unknown[]>(`/capabilities/bot/${botId}/patterns?days=${days}`),
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
}
