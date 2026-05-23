import type { Lead } from '../domain/lead/Lead.js'

export interface LeadRepository {
  findByPhone(botId: string, phoneNumber: string): Promise<Lead | null>
  findByBotId(botId: string, limit?: number, offset?: number): Promise<Lead[]>
  findByTag(botId: string, tag: string): Promise<Lead[]>
  countByBotId(botId: string): Promise<number>
  save(lead: Lead): Promise<void>
}
