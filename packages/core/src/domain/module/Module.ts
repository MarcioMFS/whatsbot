// Registro de Módulos — modelo de domínio (gap #3 do orquestrador).
// Aqui ficam só os TIPOS. O catálogo concreto (os 6 módulos) + o wiring de tools/efeitos
// vivem no ModuleRegistry do backend. Ver Brain/spec_registro_modulos.md.

export type ModuleType = 'routable' | 'tool' | 'effect'  // roteável | ferramenta | efeito

// ids canônicos dos módulos da plataforma
export const MODULE_IDS = {
  PAYMENT_PIX: 'payment_pix',
  HUMAN_HANDOFF: 'human_handoff',
  CATALOG: 'catalog',
  DELIVERY: 'delivery',
  RECOVER: 'recover',
  MEDIA: 'media',
} as const
export type ModuleId = typeof MODULE_IDS[keyof typeof MODULE_IDS]

// Metadata de um módulo da plataforma (definição). Sem zod/implementação — isso é do backend.
export interface ModuleMeta {
  id: string
  name: string                 // rótulo na UI
  type: ModuleType
  description: string          // vira descrição da Habilidade no system prompt do agente
  toolNames?: string[]         // tools que expõe (routable/tool)
  effectOn?: string            // evento que dispara (effect): ex 'payment_confirmed', 'inactivity'
  dependsOn?: string[]
  policyKeys?: string[]        // permissões finas (absorve agentPolicy)
  defaultEnabled?: boolean     // default quando o bot não tem estado explícito (hoje: tudo ligado)
}

// Estado de um módulo POR BOT (mora em bot.globalConfig.modules).
export interface BotModuleState {
  enabled: boolean
  config?: Record<string, unknown>
}
