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
}
