import { randomUUID } from 'crypto'
import type { BotModuleState } from '../module/Module.js'

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
  tag: string
  flowId: string
}

export interface BotGlobalConfig {
  defaultPixKey?: string
  defaultReceiverName?: string
  ownerPhone?: string
  supportFlowId?: string
  defaultCurrency?: string
  defaultPaymentExpirationMinutes?: number
  // Persona / Identity (multi-tenant)
  assistantIdentityMode?: 'named' | 'brand_only'
  assistantName?: string       // e.g. "Bia" — only used when mode is 'named'
  companyName?: string         // e.g. "DramaHub"
  neverExposeAI?: boolean      // default: true
  ownerTestMode?: boolean      // allow owner's fromMe messages to enter the flow
  allowIdentityDisclosure?: boolean  // allow "Sou um assistente virtual" — default: false
  tone?: 'acolhedor' | 'profissional' | 'casual' | 'formal'
  locale?: string              // e.g. 'pt-BR', 'en-US', 'es-ES' — default: 'pt-BR'
  // v2 — Agent runtime
  runtime?: 'flow' | 'agent'   // default 'flow'. 'agent' = tool-calling agent loop (lab)
  agentTestNumbers?: string[]  // whitelist: estes telefones usam o agente MESMO com runtime='flow'. Resto segue flow (produção). Kill switch = esvaziar.
  agentInstructions?: string   // prompt principal / regras do agente (Instruções)
  agentGreeting?: string       // orientação de abertura (LLM) — usada no 1º contato quando NÃO há agentIntroMessage. O agente apresenta com as palavras dele.
  agentKnowledge?: string      // "coisas que o bot deve saber" — fatos que o agente PODE usar (link do catálogo, entrega, garantia…). Ele só afirma o que está aqui; fora disso, não inventa.
  agentIntroMessage?: string   // mensagem de abertura VERBATIM (determinística) — enviada literal no 1º contato. Use quando a copy/preços precisam ser exatos (não passa pela IA). Tem prioridade sobre agentGreeting.
  agentPolicy?: AgentPolicy    // permissões nível 1 (a IA consulta, nunca edita)
  agentTone?: AgentTone        // knobs de tom — calibram a voz NATURAL (sem cara de bot)
  // (recovery migrou pro módulo 'recover' — config mora em modules.recover.config; tipo RecoveryConfig abaixo segue exportado)
  modules?: Record<string, BotModuleState>  // Registro de Módulos: liga/desliga + config por bot. Ausente = defaults (tudo ligado).
}

// Recuperação genérica de lead/carrinho — re-engajamento parametrizável por vertical.
// SEM config (undefined) = comportamento legado: trigger 'pix_generated', 30min ocioso, 2 nudges, mensagens PIX.
export interface RecoveryConfig {
  enabled?: boolean               // default true (ligado). false = desliga recuperação pra este bot.
  triggerTags?: string[]          // tags que marcam "travou em ponto interessante". default ['pix_generated']
  excludeTags?: string[]          // tags que encerram (não cutuca mais). default ['buyer','lost']
  idleMinutes?: number            // ocioso antes de cutucar (e gap entre nudges). default 30
  maxAttempts?: number            // máx de nudges por ciclo. default 2
  cadenceMinutes?: number[]       // (F3) gap mínimo antes de cada nudge; sobrepõe idleMinutes por tentativa
  messages?: string[]             // templates por tentativa, vars {nome}/{item}. default = mensagens PIX legadas
  quietHours?: { start: number; end: number }  // (F3) janela sem cutucar (hora 0-23)
}

// Botões de tom do agente — voz neutra natural (humano de verdade, sem fingir ser ninguém).
// Cada knob vira instrução de estilo no system prompt. Defaults = WhatsApp humano, curto, pouco emoji.
export interface AgentTone {
  formality?: 'informal' | 'neutro' | 'formal'   // default 'neutro'
  emoji?: 'nenhum' | 'raro' | 'moderado'         // default 'raro'
  length?: 'curtas' | 'medias'                    // default 'curtas'
  slang?: boolean                                 // gírias/regionalismos leves — default false
}

// Permissões por bot — "A IA propõe; o código dispõe". Default seguro = financeiro sensível OFF.
export interface AgentPolicy {
  can_generate_pix?: boolean       // default true
  can_validate_proof?: boolean     // default true
  can_deliver_access?: boolean     // default true
  can_transfer_human?: boolean     // default true
  can_apply_discount?: boolean     // default false
  can_refund?: boolean             // default false
  can_cancel_order?: boolean       // default false
}

export interface BotProps {
  id: string
  name: string
  productInfo: BotProductInfo
  aiConfig: BotAIConfig
  evolutionConfig: BotEvolutionConfig
  activeFlowId: string | null
  routingRules: FlowRoutingRule[]
  globalConfig?: BotGlobalConfig
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
      globalConfig: {},
      isActive: false,
      webhookSecret: randomUUID().replace(/-/g, ''),
      ownerId: params.ownerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: BotProps): Bot {
    return new Bot({ ...props, routingRules: props.routingRules ?? [], globalConfig: props.globalConfig ?? {} })
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

  updateGlobalConfig(config: Partial<BotGlobalConfig>): void {
    this.props.globalConfig = { ...this.props.globalConfig, ...config }
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
  get globalConfig() { return { ...this.props.globalConfig } }
  get isActive() { return this.props.isActive }
  get webhookSecret() { return this.props.webhookSecret }
  get ownerId() { return this.props.ownerId }
  get createdAt() { return this.props.createdAt }
  get updatedAt() { return this.props.updatedAt }

  toJSON(): BotProps {
    return { ...this.props }
  }
}
