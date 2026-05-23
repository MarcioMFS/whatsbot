import { randomUUID } from 'crypto'

export type AIProvider = 'claude' | 'groq'

export interface BotProductInfo {
  name: string
  description: string
  persona: string
  language: string
  extraContext?: string
}

export interface BotAIConfig {
  provider: AIProvider
  model: string
  temperature: number
  maxTokens: number
  systemPromptTemplate: string
}

export interface BotEvolutionConfig {
  instanceName: string
  instanceId?: string
  phoneNumber?: string
}

export interface FlowRoutingRule {
  tag: string      // if lead has this tag...
  flowId: string   // ...use this flow
}

export interface BotProps {
  id: string
  name: string
  productInfo: BotProductInfo
  aiConfig: BotAIConfig
  evolutionConfig: BotEvolutionConfig
  activeFlowId: string | null
  routingRules: FlowRoutingRule[]
  isActive: boolean
  webhookSecret: string
  ownerId: string
  createdAt: Date
  updatedAt: Date
}

export class Bot {
  private props: BotProps

  private constructor(props: BotProps) {
    this.props = props
  }

  static create(params: {
    name: string
    productInfo: BotProductInfo
    aiConfig: BotAIConfig
    evolutionConfig: BotEvolutionConfig
    ownerId: string
  }): Bot {
    if (!params.name.trim()) throw new Error('Bot name is required')
    if (!params.productInfo.name.trim()) throw new Error('Product name is required')
    if (!params.productInfo.persona.trim()) throw new Error('Bot persona is required')

    return new Bot({
      id: randomUUID(),
      name: params.name,
      productInfo: params.productInfo,
      aiConfig: params.aiConfig,
      evolutionConfig: params.evolutionConfig,
      activeFlowId: null,
      routingRules: [],
      isActive: false,
      webhookSecret: randomUUID().replace(/-/g, ''),
      ownerId: params.ownerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: BotProps): Bot {
    return new Bot({ ...props, routingRules: props.routingRules ?? [] })
  }

  activate(flowId: string): void {
    if (!flowId) throw new Error('A flow is required to activate the bot')
    this.props.activeFlowId = flowId
    this.props.isActive = true
    this.props.updatedAt = new Date()
  }

  deactivate(): void {
    this.props.isActive = false
    this.props.updatedAt = new Date()
  }

  setInstanceId(instanceId: string): void {
    this.props.evolutionConfig = { ...this.props.evolutionConfig, instanceId }
    this.props.updatedAt = new Date()
  }

  updateProductInfo(info: Partial<BotProductInfo>): void {
    this.props.productInfo = { ...this.props.productInfo, ...info }
    this.props.updatedAt = new Date()
  }

  updateAIConfig(config: Partial<BotAIConfig>): void {
    this.props.aiConfig = { ...this.props.aiConfig, ...config }
    this.props.updatedAt = new Date()
  }

  setRoutingRules(rules: FlowRoutingRule[]): void {
    this.props.routingRules = rules
    this.props.updatedAt = new Date()
  }

  resolveFlowId(leadTags: string[]): string | null {
    for (const rule of this.props.routingRules) {
      if (leadTags.includes(rule.tag.toLowerCase())) return rule.flowId
    }
    return this.props.activeFlowId
  }

  buildSystemPrompt(): string {
    const { productInfo, aiConfig } = this.props
    return aiConfig.systemPromptTemplate
      .replace('{{product_name}}', productInfo.name)
      .replace('{{product_description}}', productInfo.description)
      .replace('{{persona}}', productInfo.persona)
      .replace('{{language}}', productInfo.language)
      .replace('{{extra_context}}', productInfo.extraContext ?? '')
  }

  get id() { return this.props.id }
  get name() { return this.props.name }
  get productInfo() { return this.props.productInfo }
  get aiConfig() { return this.props.aiConfig }
  get evolutionConfig() { return this.props.evolutionConfig }
  get activeFlowId() { return this.props.activeFlowId }
  get routingRules() { return [...this.props.routingRules] }
  get isActive() { return this.props.isActive }
  get webhookSecret() { return this.props.webhookSecret }
  get ownerId() { return this.props.ownerId }
  get createdAt() { return this.props.createdAt }
  get updatedAt() { return this.props.updatedAt }

  toJSON(): BotProps {
    return { ...this.props }
  }
}
