import type { Pool } from 'pg'

export interface DetectedPattern {
  pattern: string
  normalizedPattern: string
  count: number
  currentMethod: 'default' | 'ai_low_confidence'
  examples: string[]
  suggestedAction: 'add_trigger' | 'new_capability' | 'improve_description'
  suggestedCapability?: string
}

export interface CapabilityMetrics {
  capabilityId: string | null
  capabilityName: string
  totalCalls: number
  triggerHits: number
  aiHits: number
  defaultHits: number
  avgConfidence: number
  avgLatencyMs: number
  successRate: number
  wrongRouteRate: number
}

export class PatternDetector {
  constructor(private db: Pool) {}

  async detectPatterns(botId: string, days = 7): Promise<DetectedPattern[]> {
    const { rows } = await this.db.query(
      `SELECT user_message, method, confidence, selected_capability_name
       FROM ai_observations
       WHERE bot_id = $1
         AND created_at > now() - ($2 || ' days')::interval
         AND (method = 'default' OR confidence < 0.6)
       ORDER BY created_at DESC
       LIMIT 1000`,
      [botId, days],
    )

    const groups = new Map<string, { original: string[]; method: string; capName: string | null }>()

    for (const row of rows) {
      const normalized = this.normalize(row.user_message as string)
      const existing = groups.get(normalized) ?? {
        original: [],
        method: row.method as string,
        capName: (row.selected_capability_name as string) ?? null,
      }
      existing.original.push(row.user_message as string)
      groups.set(normalized, existing)
    }

    const patterns: DetectedPattern[] = []
    for (const [normalized, data] of groups) {
      if (data.original.length >= 5) {
        patterns.push({
          pattern: data.original[0],
          normalizedPattern: normalized,
          count: data.original.length,
          currentMethod: data.method === 'default' ? 'default' : 'ai_low_confidence',
          examples: data.original.slice(0, 5),
          suggestedAction: this.suggestAction(normalized, data),
          suggestedCapability: data.capName ?? undefined,
        })
      }
    }

    return patterns.sort((a, b) => b.count - a.count)
  }

  async getCapabilityMetrics(botId: string, days = 7): Promise<CapabilityMetrics[]> {
    const { rows } = await this.db.query(
      `SELECT
         selected_capability_id,
         selected_capability_name,
         COUNT(*) AS total_calls,
         COUNT(*) FILTER (WHERE method = 'trigger') AS trigger_hits,
         COUNT(*) FILTER (WHERE method = 'ai') AS ai_hits,
         COUNT(*) FILTER (WHERE method = 'default') AS default_hits,
         AVG(confidence) FILTER (WHERE confidence IS NOT NULL) AS avg_confidence,
         AVG(duration_ms) AS avg_latency_ms,
         COUNT(*) FILTER (WHERE outcome = 'success') AS successes,
         COUNT(*) FILTER (WHERE outcome = 'wrong_route') AS wrong_routes
       FROM ai_observations
       WHERE bot_id = $1
         AND created_at > now() - ($2 || ' days')::interval
       GROUP BY selected_capability_id, selected_capability_name
       ORDER BY total_calls DESC`,
      [botId, days],
    )

    return rows.map(row => ({
      capabilityId: (row.selected_capability_id as string) ?? null,
      capabilityName: (row.selected_capability_name as string) ?? 'Unknown',
      totalCalls: parseInt(row.total_calls as string),
      triggerHits: parseInt(row.trigger_hits as string),
      aiHits: parseInt(row.ai_hits as string),
      defaultHits: parseInt(row.default_hits as string),
      avgConfidence: parseFloat(row.avg_confidence as string) || 0,
      avgLatencyMs: parseFloat(row.avg_latency_ms as string) || 0,
      successRate: parseInt(row.total_calls as string) > 0
        ? parseInt(row.successes as string) / parseInt(row.total_calls as string)
        : 0,
      wrongRouteRate: parseInt(row.total_calls as string) > 0
        ? parseInt(row.wrong_routes as string) / parseInt(row.total_calls as string)
        : 0,
    }))
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private suggestAction(
    normalized: string,
    data: { method: string; capName: string | null },
  ): DetectedPattern['suggestedAction'] {
    if (normalized.split(' ').length <= 2) return 'add_trigger'
    if (data.method !== 'default' && data.capName) return 'improve_description'
    return 'new_capability'
  }
}
