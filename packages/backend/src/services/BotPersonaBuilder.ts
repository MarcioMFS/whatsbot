import type { BotGlobalConfig } from '@whatsbot/core'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BotPersona {
  identityLine: string    // "Você é a Bia, assistente oficial da DramaHub."
  signatureName: string   // "Bia" | "Equipe DramaHub" | "Atendimento"
  companyRef: string      // "DramaHub" | "nossa empresa"
  rulesBlock: string      // full identity + tone rules — injected into system prompts
  locale: string          // 'pt-BR' (future: 'en-US', 'es-ES')
  allowIdentityDisclosure: boolean
}

export interface BotPersonaPreview {
  identityLine: string
  greetingExample: string
  paymentExample: string
  handoffExample: string
  toneExample: string
}

// ─── Tone guide ──────────────────────────────────────────────────────────────

const TONE_GUIDE: Record<NonNullable<BotGlobalConfig['tone']>, string> = {
  acolhedor:    'TOM: caloroso e acolhedor. Use emojis com moderação (1-2 por mensagem). Respostas curtas e diretas. Diminutivos ocasionais ("rapidinho", "pertinho"). Evite termos técnicos.',
  casual:       'TOM: muito informal, como amigo ajudando. Emojis frequentes (2-3 por mensagem). Frases bem curtas. Gírias leves aceitáveis ("boa", "show").',
  profissional: 'TOM: profissional e acessível. Máximo 1 emoji por mensagem. Sem gírias. Frases completas e bem estruturadas.',
  formal:       'TOM: formal e respeitoso. Zero emojis. Frases completas. Sem abreviações. Evite informalidades.',
}

const TONE_GREETING: Record<NonNullable<BotGlobalConfig['tone']>, (name: string) => string> = {
  acolhedor:    (n) => `Oi! Sou ${n} 😊 Como posso te ajudar hoje?`,
  casual:       (n) => `Oi! Sou ${n} 😄 Me fala o que você procura!`,
  profissional: (n) => `Olá! Sou ${n}. Como posso ajudá-lo?`,
  formal:       (n) => `Bom dia. Sou ${n}. Como posso ser útil?`,
}

const TONE_PAYMENT: Record<NonNullable<BotGlobalConfig['tone']>, string> = {
  acolhedor:    'Perfeito 😊 Me envie o comprovantinho do Pix por aqui!',
  casual:       'Show! Me manda o comprovante do Pix 😄',
  profissional: 'Certo. Por favor, envie o comprovante do pagamento.',
  formal:       'Confirmado. Encaminhe o comprovante de pagamento para prosseguirmos.',
}

const TONE_HANDOFF: Record<NonNullable<BotGlobalConfig['tone']>, string> = {
  acolhedor:    'Claro 😊 Vou verificar isso com mais cuidado pra te ajudar certinho.',
  casual:       'Entendi! Deixa eu dar uma olhada nisso pra resolver pra você 😊',
  profissional: 'Entendido. Vou analisar sua situação com atenção.',
  formal:       'Compreendido. Verificarei seu caso e retornaremos em breve.',
}

const TONE_EXAMPLE: Record<NonNullable<BotGlobalConfig['tone']>, string> = {
  acolhedor:    '"Oi 😊 Tudo bem? Me fala o que você precisa!"',
  casual:       '"Oi! Que bom te ver aqui 😄 O que você tá procurando?"',
  profissional: '"Olá! Como posso ajudá-lo hoje?"',
  formal:       '"Bom dia. Em que posso ser útil?"',
}

// ─── Input sanitizer ─────────────────────────────────────────────────────────

function sanitizeText(value: string | undefined, maxLen = 80): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLen)
}

function sanitizeMode(value: string | undefined): 'named' | 'brand_only' {
  if (value === 'named' || value === 'brand_only') return value
  return 'brand_only'
}

function sanitizeTone(value: string | undefined): NonNullable<BotGlobalConfig['tone']> {
  const valid = ['acolhedor', 'profissional', 'casual', 'formal'] as const
  return (valid as readonly string[]).includes(value ?? '') ? value as NonNullable<BotGlobalConfig['tone']> : 'acolhedor'
}

function sanitizeLocale(value: string | undefined): string {
  const supported = ['pt-BR', 'en-US', 'es-ES']
  return supported.includes(value ?? '') ? value! : 'pt-BR'
}

// ─── Cache (hash-based, no explicit TTL needed) ───────────────────────────────

interface CacheEntry { hash: string; persona: BotPersona }
const personaCache = new Map<string, CacheEntry>()

function hashConfig(config: BotGlobalConfig): string {
  const { assistantIdentityMode, assistantName, companyName, neverExposeAI, allowIdentityDisclosure, tone, locale } = config
  return JSON.stringify({ assistantIdentityMode, assistantName, companyName, neverExposeAI, allowIdentityDisclosure, tone, locale })
}

export function invalidatePersonaCache(botId: string): void {
  personaCache.delete(botId)
}

// ─── Core builder ────────────────────────────────────────────────────────────

function _buildPersona(config: BotGlobalConfig): BotPersona {
  const mode = sanitizeMode(config.assistantIdentityMode)
  const name = sanitizeText(config.assistantName)
  const company = sanitizeText(config.companyName)
  const neverExposeAI = config.neverExposeAI !== false
  const allowIdentityDisclosure = config.allowIdentityDisclosure === true
  const tone = sanitizeTone(config.tone)
  const locale = sanitizeLocale(config.locale)

  let identityLine: string
  let signatureName: string
  const companyRef = company ?? 'nossa empresa'

  if (mode === 'named' && name && company) {
    identityLine = `Você é ${name}, assistente oficial da ${company}.`
    signatureName = name
  } else if (mode === 'named' && name) {
    identityLine = `Você é ${name}, assistente de atendimento.`
    signatureName = name
  } else if (company) {
    identityLine = `Você é o atendimento oficial da ${company}.`
    signatureName = `Equipe ${company}`
  } else {
    identityLine = 'Você é um assistente de atendimento oficial.'
    signatureName = 'Atendimento'
  }

  const aiDisclosureRule = neverExposeAI && !allowIdentityDisclosure
    ? '- Nunca diga que é uma IA, robô, sistema ou chatbot — mesmo que perguntado diretamente'
    : allowIdentityDisclosure
      ? '- Se perguntado diretamente, pode dizer que é um assistente virtual'
      : null

  const rulesLines = [
    'IDENTIDADE:',
    `- ${identityLine}`,
    aiDisclosureRule,
    '- Nunca mencione transição para humano, atendente ou suporte — o atendimento é contínuo',
    `- O atendimento é sempre de responsabilidade da ${companyRef}`,
    '',
    TONE_GUIDE[tone],
  ].filter((l): l is string => l !== null)

  return {
    identityLine,
    signatureName,
    companyRef,
    rulesBlock: rulesLines.join('\n'),
    locale,
    allowIdentityDisclosure,
  }
}

export function buildBotPersona(config: BotGlobalConfig, botId?: string): BotPersona {
  if (!botId) return _buildPersona(config)

  const hash = hashConfig(config)
  const cached = personaCache.get(botId)
  if (cached?.hash === hash) return cached.persona

  const persona = _buildPersona(config)
  personaCache.set(botId, { hash, persona })
  return persona
}

// ─── Preview ─────────────────────────────────────────────────────────────────

export function buildBotPersonaPreview(config: BotGlobalConfig): BotPersonaPreview {
  const persona = _buildPersona(config)
  const tone = sanitizeTone(config.tone)
  const greetingName = persona.signatureName

  return {
    identityLine: persona.identityLine,
    greetingExample: TONE_GREETING[tone](greetingName),
    paymentExample: TONE_PAYMENT[tone],
    handoffExample: TONE_HANDOFF[tone],
    toneExample: TONE_EXAMPLE[tone],
  }
}

// ─── Zod schema (used by route) ───────────────────────────────────────────────

import { z } from 'zod'

export const GlobalConfigSchema = z.object({
  defaultPixKey:                   z.string().trim().max(200).optional(),
  defaultReceiverName:             z.string().trim().max(100).optional(),
  ownerPhone:                      z.string().trim().max(30).optional(),
  supportFlowId:                   z.string().uuid().optional(),
  defaultCurrency:                 z.string().trim().max(10).optional(),
  defaultPaymentExpirationMinutes: z.number().int().min(1).max(10080).optional(),
  // Persona
  assistantIdentityMode:    z.enum(['named', 'brand_only']).optional(),
  assistantName:            z.string().trim().min(1).max(80).optional(),
  companyName:              z.string().trim().min(1).max(80).optional(),
  neverExposeAI:            z.boolean().optional(),
  allowIdentityDisclosure:  z.boolean().optional(),
  tone:                     z.enum(['acolhedor', 'profissional', 'casual', 'formal']).optional(),
  locale:                   z.enum(['pt-BR', 'en-US', 'es-ES']).optional(),
  ownerTestMode:            z.boolean().optional(),
  // Agente v2 — runtime, prompt, abertura, conhecimento, tom e política
  runtime:                  z.enum(['flow', 'agent']).optional(),
  agentTestNumbers:         z.array(z.string().trim().max(30)).max(50).optional(),
  agentInstructions:        z.string().max(8000).optional(),
  agentGreeting:            z.string().max(2000).optional(),
  agentKnowledge:           z.string().max(8000).optional(),
  agentIntroMessage:        z.string().max(2000).optional(),
  agentTone: z.object({
    formality: z.enum(['informal', 'neutro', 'formal']).optional(),
    emoji:     z.enum(['nenhum', 'raro', 'moderado']).optional(),
    length:    z.enum(['curtas', 'medias']).optional(),
    slang:     z.boolean().optional(),
  }).strict().optional(),
  agentPolicy: z.object({
    can_generate_pix:   z.boolean().optional(),
    can_validate_proof: z.boolean().optional(),
    can_deliver_access: z.boolean().optional(),
    can_transfer_human: z.boolean().optional(),
    can_apply_discount: z.boolean().optional(),
    can_refund:         z.boolean().optional(),
    can_cancel_order:   z.boolean().optional(),
  }).strict().optional(),
  // Registro de Módulos (liga/desliga + config por bot) — a config de recuperação mora em modules.recover.config
  modules: z.record(z.object({
    enabled: z.boolean(),
    config:  z.record(z.unknown()).optional(),
  }).strict()).optional(),
  // Escape hatch — "IA cobre lacunas" (ver Brain/spec_escape_hatch.md). Default do bot; parte pode sobrescrever.
  aiGapFill: z.object({
    enabled:        z.boolean().optional(),
    onUnhandled:    z.enum(['reask', 'handoff']).optional(),
    maxConsecutive: z.number().int().min(1).max(10).optional(),
  }).strict().optional(),
  capabilityRouterEnabled: z.boolean().optional(),   // false = desliga CapabilityRouter legado
  productNoun: z.string().trim().max(40).optional(),  // substantivo do produto (ex.: "série", "curso") — neutraliza o agente
}).strict()

export type GlobalConfigInput = z.infer<typeof GlobalConfigSchema>
