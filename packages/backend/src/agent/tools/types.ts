import type { Bot, Lead, Conversation, PaymentIntentRepository, PackageOfferRepository, ProductRepository, OrderRepository } from '@whatsbot/core'
import type { CatalogSearchService } from '../../services/CatalogSearchService.js'
import type { PaymentOrchestrator } from '../../payment/PaymentOrchestrator.js'

// Standardized return contract for EVERY tool (decisão Marcio 2026-06-06).
export interface ToolResult {
  success: boolean
  code: string                  // 'OK' | 'EMPTY_CART' | 'PROOF_INVALID' | 'NOT_FOUND' | ...
  message?: string
  data?: unknown
  confidence?: number
}

export interface ToolServices {
  catalogSearchService: CatalogSearchService
  productRepo: ProductRepository
  paymentIntentRepo: PaymentIntentRepository
  packageOfferRepo: PackageOfferRepository
  paymentOrchestrator: PaymentOrchestrator
  orderRepo: OrderRepository
}

export interface ToolContext {
  bot: Bot
  conversation: Conversation
  lead: Lead | null
  imageBase64?: string
  services: ToolServices
}

export interface AgentTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  guarded: boolean              // true = ação sensível (passa por política + invariante)
  policyKey?: string            // chave em BotGlobalConfig.agentPolicy (ex: 'can_generate_pix')
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}
