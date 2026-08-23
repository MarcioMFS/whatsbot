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

  // O nome da instância vem do nome do bot ("Vox" → "vox"). Se já existe uma instância com
  // esse nome, o evolution-go responde 500 "instance already exists" e a criação inteira
  // morria com Internal Server Error na cara do usuário — sem dizer o motivo e sem saída.
  // Aqui o nome é desambiguado (vox → vox-2) antes de qualquer coisa ser gravada.
  private async resolveFreeInstanceName(desired: string): Promise<string> {
    if (!this.messaging.instanceExists) return desired // adapter sem suporte: segue o fluxo antigo
    try {
      if (!(await this.messaging.instanceExists(desired))) return desired
      for (let n = 2; n <= 20; n++) {
        const candidate = `${desired}-${n}`
        if (!(await this.messaging.instanceExists(candidate))) {
          console.warn(`[BotService] instância "${desired}" já existe → usando "${candidate}"`)
          return candidate
        }
      }
      throw new Error(`Já existem muitos bots com o nome "${desired}". Escolha outro nome.`)
    } catch (e) {
      // Falha ao consultar o evolution não pode impedir a criação: segue com o nome pedido
      // e deixa o createInstance falhar com a mensagem dele, se for o caso.
      if (e instanceof Error && e.message.startsWith('Já existem muitos bots')) throw e
      console.error('[BotService] não deu pra checar colisão de instância:', e instanceof Error ? e.message : e)
      return desired
    }
  }

  async createBot(params: {
    name: string
    productInfo: BotProductInfo
    aiConfig: BotAIConfig
    evolutionConfig: BotEvolutionConfig
    ownerId: string
    webhookBaseUrl: string
  }): Promise<Bot> {
    const instanceName = await this.resolveFreeInstanceName(params.evolutionConfig.instanceName)
    const evolutionConfig = { ...params.evolutionConfig, instanceName }

    const bot = Bot.create({
      name: params.name,
      productInfo: params.productInfo,
      aiConfig: params.aiConfig,
      evolutionConfig,
      ownerId: params.ownerId,
    })

    // #sec C2: secret no path (gateway evolution-go não envia header). Guard p/ secret vazio (não muta bot).
    const webhookUrl = bot.webhookSecret
      ? `${params.webhookBaseUrl}/webhooks/evolution/${bot.id}/${bot.webhookSecret}`
      : `${params.webhookBaseUrl}/webhooks/evolution/${bot.id}`
    const result = await this.messaging.createInstance(
      instanceName, // já desambiguado — o do params pode estar ocupado
      webhookUrl,
      bot.webhookSecret,
    ) as { qrCode: string; instanceId?: string }

    if (result.instanceId) bot.setInstanceId(result.instanceId)

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
    // #sec C2: secret no path (ver createBot). Guard p/ secret vazio.
    const webhookUrl = bot.webhookSecret
      ? `${webhookBaseUrl}/webhooks/evolution/${bot.id}/${bot.webhookSecret}`
      : `${webhookBaseUrl}/webhooks/evolution/${bot.id}`

    try {
      const { qrCode } = await this.messaging.connectInstance(instanceName, webhookUrl)
      return qrCode
    } catch {
      await this.messaging.createInstance(instanceName, webhookUrl, bot.webhookSecret)
      await new Promise(r => setTimeout(r, 2000))
      const { qrCode } = await this.messaging.connectInstance(instanceName, webhookUrl)
      return qrCode
    }
  }
}
