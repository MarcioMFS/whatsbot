import type { Flow } from '../domain/flow/Flow.js'

export interface FlowRepository {
  findById(id: string): Promise<Flow | null>
  findByBotId(botId: string): Promise<Flow[]>
  save(flow: Flow): Promise<void>
  delete(id: string): Promise<void>
}
