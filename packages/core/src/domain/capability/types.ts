export type TriggerType = 'keyword' | 'phrase' | 'state' | 'tag'

export interface CapabilityTrigger {
  type: TriggerType
  value: string
  priority: number
}

export interface CapabilityProps {
  id: string
  botId: string
  name: string
  description: string
  examples: string[]
  exclusions: string[]
  triggers: CapabilityTrigger[]
  flowId: string
  isDefault: boolean
  isEnabled: boolean
  priority: number
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
