import type { Capability } from '../domain/capability/Capability.js'
import type { CapabilityProps } from '../domain/capability/types.js'

export interface CapabilityRepository {
  findById(id: string): Promise<Capability | null>
  findByBotId(botId: string): Promise<Capability[]>
  findEnabledByBotId(botId: string): Promise<Capability[]>
  save(capability: Capability): Promise<void>
  update(id: string, data: Partial<CapabilityProps>): Promise<Capability>
  delete(id: string): Promise<void>
  clearDefault(botId: string): Promise<void>
}
