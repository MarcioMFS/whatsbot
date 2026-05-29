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

export interface AIObservationRepository {
  save(observation: AIObservation): Promise<void>
  findByBotId(botId: string, limit?: number): Promise<AIObservation[]>
  findProblematic(botId: string, days: number): Promise<AIObservation[]>
  updateOutcome(id: string, outcome: string, reason?: string): Promise<void>
}
