export interface AIObservation {
  id?: string
  botId: string
  conversationId?: string
  phoneNumber: string
  userMessage: string
  hasImage: boolean
  phase?: string
  cartCount?: number
  leadTags?: string[]
  historyLength?: number
  layer: string
  selectedCapabilityId?: string
  selectedCapabilityName?: string
  selectedIntent?: string
  method: string
  confidence?: number
  reasoning?: string
  allScores?: Record<string, number>
  matchedTriggers?: string[]
  provider?: string
  model?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  outcome?: string
  outcomeReason?: string
  createdAt?: Date
}

export interface AIObservationIntentStat {
  intent: string
  count: number
  escalated: number
}

export interface AIObservationStats {
  total: number
  aiCount: number
  defaultCount: number
  fallbackRate: number
  successCount: number
  escalatedCount: number
  pendingCount: number
  byIntent: AIObservationIntentStat[]
}

export interface AIObservationRepository {
  save(observation: AIObservation): Promise<void>
  findById(id: string): Promise<AIObservation | null>
  findByBotId(botId: string, limit?: number): Promise<AIObservation[]>
  findProblematic(botId: string, days: number): Promise<AIObservation[]>
  getStats(botId: string, days: number): Promise<AIObservationStats>
  updateOutcome(id: string, outcome: string, reason?: string): Promise<void>
  updateOutcomeByConversation(conversationId: string, outcome: string, reason?: string): Promise<void>
}
