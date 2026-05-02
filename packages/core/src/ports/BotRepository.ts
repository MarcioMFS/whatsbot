import type { Bot } from '../domain/bot/Bot.js'

export interface BotRepository {
  findById(id: string): Promise<Bot | null>
  findByOwnerId(ownerId: string): Promise<Bot[]>
  findByInstanceName(instanceName: string): Promise<Bot | null>
  save(bot: Bot): Promise<void>
  delete(id: string): Promise<void>
}
