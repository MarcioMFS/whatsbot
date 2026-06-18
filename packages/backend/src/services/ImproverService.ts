import type { Pool } from 'pg'
import type { AIGenerationService } from './AIGenerationService.js'
import type { PatternDetector } from './PatternDetector.js'
import type { PostgreSQLProposalRepository, FlowProposal } from '../adapters/PostgreSQLProposalRepository.js'

// Improver — "observa → analisa → propõe". Lê SINAIS reais (mensagens não-entendidas + escalações) e pede
// pra IA (cadeia FREE) propor melhorias concretas. Gera proposta ADVISORY no gate (humano lê e age).
// Pré-req p/ bot-agente: AgentRuntime ainda não escreve ai_observations/handoffs ricos → improver enxerga
// melhor bots em runtime=flow. (ver Brain/spec_builder_improver.md, crítica.)
export class ImproverService {
  constructor(
    private db: Pool,
    private patternDetector: PatternDetector,
    private ai: AIGenerationService,
    private proposalRepo: PostgreSQLProposalRepository,
  ) {}

  async scan(botId: string, days = 7): Promise<{ proposal: FlowProposal | null; reason?: string }> {
    const patterns = await this.patternDetector.detectPatterns(botId, days)
    const handoffReasons = await this.handoffReasons(botId, days)

    if (patterns.length === 0 && handoffReasons.length === 0) {
      return { proposal: null, reason: 'Sem sinal suficiente ainda (poucas conversas problemáticas registradas).' }
    }

    // Resumo dos sinais reais pra IA analisar.
    const signalText = [
      patterns.length ? `Mensagens que o bot NÃO entendeu (caíram em fallback), agrupadas:\n${patterns.slice(0, 12).map(p => `- "${p.pattern}" (${p.count}x; sugestão: ${p.suggestedAction})`).join('\n')}` : '',
      handoffReasons.length ? `Escalações pra humano por motivo:\n${handoffReasons.map(h => `- ${h.reason}: ${h.count}x`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')

    const systemPrompt = [
      'Você analisa a saúde de um bot de vendas no WhatsApp a partir de SINAIS reais de conversas.',
      'A partir dos sinais, proponha melhorias CONCRETAS e acionáveis (no máximo 5).',
      'Cada sugestão: title (curto), problem (o que os dados mostram), recommendation (o que fazer — ex.: adicionar gatilho/capability, melhorar uma descrição, ajustar um nó).',
      'Responda APENAS um JSON: {"summary":"...","suggestions":[{"title","problem","recommendation"}]}. Sem texto fora do JSON.',
    ].join('\n')

    let parsed: { summary?: string; suggestions?: unknown }
    try {
      const r = await this.ai.generateBuilder({
        systemPrompt,
        promptTemplate: `Sinais do bot (últimos ${days} dias):\n\n${signalText}`,
        history: [], userMessage: 'Analise e proponha melhorias.', variables: {},
        temperature: 0.3, maxTokens: 2000,
      })
      const start = r.content.indexOf('{'); const end = r.content.lastIndexOf('}')
      parsed = start >= 0 && end >= 0 ? JSON.parse(r.content.slice(start, end + 1)) : {}
    } catch (err) {
      throw new Error(`Falha na análise da IA: ${err instanceof Error ? err.message : err}`)
    }

    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
    if (suggestions.length === 0) return { proposal: null, reason: 'A IA não retornou sugestões acionáveis.' }

    const proposal = await this.proposalRepo.create({
      botId,
      flowId: null, // advisory — não aplica num flow específico
      kind: 'improve_routing',
      targetRuntime: null,
      proposedContent: {
        summary: parsed.summary ?? '',
        suggestions,
        signals: { unhandledPatterns: patterns.slice(0, 12), handoffReasons },
      },
      createdBy: 'ai',
    })
    return { proposal }
  }

  private async handoffReasons(botId: string, days: number): Promise<Array<{ reason: string; count: number }>> {
    try {
      const { rows } = await this.db.query(
        `SELECT reason, count(*)::int AS count FROM handoffs
         WHERE bot_id = $1 AND created_at > now() - ($2 || ' days')::interval
         GROUP BY reason ORDER BY count DESC LIMIT 15`,
        [botId, days],
      )
      return rows.map(r => ({ reason: (r.reason as string) ?? 'desconhecido', count: Number(r.count) }))
    } catch {
      return []
    }
  }
}
