// Desfecho FINAL de uma conversa — 1 registro por conversa, materializado quando ela encerra.
// É o sinal-base do loop evolutivo (F0): "o que confirma venda". Ver Brain/spec_gerador_evolutivo.md.
export type ConversationOutcomeType = 'paid' | 'abandoned' | 'escalated' | 'timeout' | 'completed'

export interface ConversationOutcome {
  conversationId: string
  botId: string
  flowId?: string | null
  patternSetVersion?: string | null   // qual versão de padrão gerou o flow (preenchido no F3+)
  lastPhase?: string | null
  outcome: ConversationOutcomeType
  gmvCentavos?: number | null          // valor do carrinho no momento (só faz sentido em paid/abandoned)
  timeToOutcomeS?: number | null
}

// Deriva o desfecho de uma conversa que chegou ao FIM do fluxo (nó end / sem próximo nó):
// se passou pela fase pós-compra, foi venda; senão, encerrou sem comprar.
export function deriveTerminalOutcome(phase: string | null | undefined): ConversationOutcomeType {
  return phase === 'post_purchase' ? 'paid' : 'completed'
}
