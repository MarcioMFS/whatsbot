import { Bot, Flow, type BotRepository, type FlowRepository, type MessagingPort } from '@whatsbot/core'
import type {
  BotProductInfo,
  BotAIConfig,
  BotEvolutionConfig,
} from '@whatsbot/core'

export class BotService {
  constructor(
    private botRepo: BotRepository,
    private flowRepo: FlowRepository,
    private messaging: MessagingPort,
  ) {}

  async createBot(params: {
    name: string
    productInfo: BotProductInfo
    aiConfig: BotAIConfig
    evolutionConfig: BotEvolutionConfig
    ownerId: string
    webhookBaseUrl: string
  }): Promise<Bot> {
    const bot = Bot.create({
      name: params.name,
      productInfo: params.productInfo,
      aiConfig: params.aiConfig,
      evolutionConfig: params.evolutionConfig,
      ownerId: params.ownerId,
    })

    const webhookUrl = `${params.webhookBaseUrl}/webhooks/evolution/${bot.id}`
    // Evolution API v2: webhook must be set at instance creation time
    await this.messaging.createInstance(
      params.evolutionConfig.instanceName,
      webhookUrl,
      bot.webhookSecret,
    )

    await this.botRepo.save(bot)

    const defaultFlow = Flow.create({ botId: bot.id, name: 'Default Flow' })
    await this.flowRepo.save(defaultFlow)

    return bot
  }

  async activateBot(botId: string, flowId: string): Promise<Bot> {
    const bot = await this.botRepo.findById(botId)
    if (!bot) throw new Error('Bot not found')

    const flow = await this.flowRepo.findById(flowId)
    if (!flow) throw new Error('Flow not found')

    flow.validate()
    bot.activate(flowId)

    await this.botRepo.save(bot)
    return bot
  }

  async deactivateBot(botId: string): Promise<Bot> {
    const bot = await this.botRepo.findById(botId)
    if (!bot) throw new Error('Bot not found')

    bot.deactivate()
    await this.botRepo.save(bot)
    return bot
  }

  async getQRCode(botId: string, webhookBaseUrl: string): Promise<string> {
    const bot = await this.botRepo.findById(botId)
    if (!bot) throw new Error('Bot not found')

    const instanceName = bot.evolutionConfig.instanceName
    const webhookUrl = `${webhookBaseUrl}/webhooks/evolution/${bot.id}`

    const pollQR = async (): Promise<string> => {
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const { qrCode } = await this.messaging.connectInstance(instanceName)
        if (qrCode) return qrCode
      }
      return ''
    }

    try {
      const { qrCode } = await this.messaging.connectInstance(instanceName)
      if (qrCode) return qrCode
      return pollQR()
    } catch {
      await this.messaging.createInstance(instanceName, webhookUrl, bot.webhookSecret)
      return pollQR()
    }
  }
}
