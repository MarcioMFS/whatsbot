import type { Bot, ModuleMeta } from '@whatsbot/core'
import { MODULE_IDS } from '@whatsbot/core'

// Catálogo concreto da plataforma — os 6 módulos do DramaHub (ver Brain/spec_registro_modulos.md).
// defaultEnabled=true reproduz o "tudo ligado" de hoje quando o bot não tem estado explícito.
const MODULE_DEFS: ModuleMeta[] = [
  {
    id: MODULE_IDS.PAYMENT_PIX, name: 'Pagamento PIX', type: 'routable',
    description: 'Cobra via PIX e confere o comprovante.',
    toolNames: ['generate_pix', 'validate_proof'],
    policyKeys: ['can_generate_pix', 'can_validate_proof', 'can_refund', 'can_cancel_order'],
    defaultEnabled: true,
  },
  {
    id: MODULE_IDS.HUMAN_HANDOFF, name: 'Falar com humano', type: 'routable',
    description: 'Transfere a conversa pra um atendente humano.',
    toolNames: ['human_handoff'], policyKeys: ['can_transfer_human'], defaultEnabled: true,
  },
  {
    id: MODULE_IDS.CATALOG, name: 'Catálogo', type: 'tool',
    description: 'Busca títulos no catálogo e monta o carrinho.',
    toolNames: ['search_catalog', 'add_to_cart', 'cart_summary'], defaultEnabled: true,
  },
  {
    id: MODULE_IDS.DELIVERY, name: 'Entrega do acesso', type: 'effect',
    description: 'Entrega o acesso automaticamente após o pagamento confirmado.',
    toolNames: ['deliver_access'], effectOn: 'payment_confirmed',
    policyKeys: ['can_deliver_access'], dependsOn: [MODULE_IDS.PAYMENT_PIX], defaultEnabled: true,
  },
  {
    id: MODULE_IDS.RECOVER, name: 'Recuperar cliente', type: 'effect',
    description: 'Reengaja quem travou num ponto de interesse e sumiu.',
    effectOn: 'inactivity', defaultEnabled: true,
  },
  {
    id: MODULE_IDS.MEDIA, name: 'Imagem / Áudio / PDF', type: 'tool',
    description: 'Lê imagem, áudio e PDF que o cliente manda (visão, transcrição).',
    defaultEnabled: true,
  },
]

// Resolve o estado dos módulos por bot. F1: nada consome ainda — só resolve (com fallback ao blob legado).
// F2 usa toolsForBot p/ montar o tool-set do agente; F3 usa effectsForBot p/ inscrever hooks.
export class ModuleRegistry {
  definitions(): ModuleMeta[] {
    return MODULE_DEFS
  }

  get(id: string): ModuleMeta | undefined {
    return MODULE_DEFS.find(m => m.id === id)
  }

  isEnabled(bot: Bot, id: string): boolean {
    const state = bot.globalConfig?.modules?.[id]
    if (state) return state.enabled
    return this.get(id)?.defaultEnabled ?? true   // sem estado explícito → default (hoje: tudo ligado)
  }

  // Config do módulo, com fallback ao blob legado (migração F1-style — comportamento idêntico).
  configFor(bot: Bot, id: string): Record<string, unknown> {
    const explicit = bot.globalConfig?.modules?.[id]?.config
    if (explicit) return explicit
    return this.legacyConfig(bot, id)
  }

  // Tools dos módulos LIGADOS (routable/tool). F2 consome p/ montar o tool-set do agente.
  toolsForBot(bot: Bot): string[] {
    return MODULE_DEFS
      .filter(m => (m.type === 'routable' || m.type === 'tool') && this.isEnabled(bot, m.id))
      .flatMap(m => m.toolNames ?? [])
  }

  // Efeitos LIGADOS (effect). F3 consome p/ inscrever os hooks de evento.
  effectsForBot(bot: Bot): ModuleMeta[] {
    return MODULE_DEFS.filter(m => m.type === 'effect' && this.isEnabled(bot, m.id))
  }

  // Mapeia cada módulo ao seu blob legado no globalConfig (ponte durante a migração).
  private legacyConfig(bot: Bot, id: string): Record<string, unknown> {
    const g = bot.globalConfig ?? {}
    switch (id) {
      case MODULE_IDS.PAYMENT_PIX:
        return { pixKey: g.defaultPixKey, receiverName: g.defaultReceiverName, expirationMinutes: g.defaultPaymentExpirationMinutes }
      case MODULE_IDS.HUMAN_HANDOFF:
        return { ownerPhone: g.ownerPhone }
      // RECOVER não tem mais blob legado — config vem só de modules.recover.config (default {} → TimeoutService aplica defaults).
      default:
        return {}
    }
  }
}
