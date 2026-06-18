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

    // Resumo dos sinais reais — COM exemplos do que o cliente pediu (não só contagem), pra a IA propor ação concreta.
    const REASON_PT: Record<string, string> = {
      series_not_found: 'título não encontrado no catálogo', pix_failed: 'falha no pagamento PIX',
      unknown_intent: 'bot não entendeu o pedido', capture_stuck: 'cliente travado num passo',
      fraud_accusation: 'cliente reclamou de cobrança', user_request: 'cliente pediu humano',
    }
    const signalText = [
      handoffReasons.length ? `Escalações pra humano (motivo: nº de vezes — exemplos do que o cliente disse):\n${handoffReasons.map(h => `- ${REASON_PT[h.reason] ?? h.reason}: ${h.count}x${h.examples.length ? ` — ex.: ${h.examples.map(e => `"${e}"`).join(', ')}` : ''}`).join('\n')}` : '',
      patterns.length ? `Mensagens que o bot não entendeu (caíram em fallback):\n${patterns.slice(0, 12).map(p => `- "${p.pattern}" (${p.count}x)`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')

    // Prompt ANCORADO no sistema real + escrito pro OPERADOR (dono do bot), não pra um dev.
    const systemPrompt = [
      'Você é um analista do "DramaHub", um bot de WhatsApp que VENDE minisséries (doramas dublados) com pagamento via PIX.',
      'Como o sistema realmente funciona: há um CATÁLOGO de produtos (cada série = um produto com nome + sinônimos/aliases + link de acesso). O cliente manda o nome, o bot BUSCA no catálogo (busca por nome/aliases) e, se acha, vende e entrega o link após o PIX.',
      'As ÚNICAS alavancas que o DONO tem no painel são: (1) ADICIONAR um título novo ao catálogo; (2) ADICIONAR sinônimos/aliases a um título existente (ex.: apelidos, variações de escrita, com/sem "dublado"); (3) editar a mensagem/descrição de uma etapa do fluxo; (4) ligar/desligar módulos. Ele NÃO programa, NÃO "treina modelo", NÃO faz "interface de busca", NÃO mexe em IA.',
      'PROIBIDO sugerir: "treinar o modelo de linguagem", "melhorar a interface de busca", "filtros avançados", "machine learning", ou qualquer coisa de dev/ML. Se sugerir isso, está ERRADO.',
      'Use os EXEMPLOS reais. Ex.: se vários clientes pediram títulos que não existem, a ação é "adicionar esses títulos ao catálogo (ou comprar essas séries)" e cite os nomes. Se pediram um título com nome diferente de um que existe, a ação é "adicionar esses nomes como aliases do produto X".',
      'Proponha no máximo 5 melhorias. Cada uma: title (curto), problem (o que os dados mostram, com números/exemplos reais), recommendation (a AÇÃO concreta que o dono faz no painel, citando títulos/nomes reais).',
      'Escreva em PT-BR, direto, pra um lojista (não um programador). Responda APENAS JSON: {"summary":"...","suggestions":[{"title","problem","recommendation"}]}. Sem texto fora do JSON.',
    ].join('\n')

    let parsed: { summary?: string; suggestions?: unknown }
    try {
      const r = await this.ai.generateBuilder({
        systemPrompt,
        promptTemplate: `Sinais do bot (últimos ${days} dias):\n\n${signalText}`,
        history: [], userMessage: 'Analise e proponha melhorias.', variables: {},
        temperature: 0.3, maxTokens: 4000,
      })
      parsed = parseLooseJson(r.content)
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

  private async handoffReasons(botId: string, days: number): Promise<Array<{ reason: string; count: number; examples: string[] }>> {
    try {
      const { rows } = await this.db.query(
        `SELECT reason, count(*)::int AS count,
                (array_agg(DISTINCT left(last_message, 60)) FILTER (WHERE last_message IS NOT NULL AND last_message <> ''))[1:5] AS examples
         FROM handoffs
         WHERE bot_id = $1 AND created_at > now() - ($2 || ' days')::interval
         GROUP BY reason ORDER BY count DESC LIMIT 15`,
        [botId, days],
      )
      return rows.map(r => ({
        reason: (r.reason as string) ?? 'desconhecido',
        count: Number(r.count),
        examples: ((r.examples as string[] | null) ?? []).filter(Boolean),
      }))
    } catch {
      return []
    }
  }
}

// Parse tolerante: tenta o JSON inteiro; se truncar (modelo cortou no maxTokens), salva os objetos
// completos de dentro de "suggestions":[ … ] por varredura de chaves. Insurance — não derruba o improver.
function parseLooseJson(raw: string): { summary?: string; suggestions?: unknown } {
  const start = raw.indexOf('{')
  if (start < 0) return {}
  const end = raw.lastIndexOf('}')
  if (end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) } catch { /* truncado → salvage abaixo */ }
  }
  const summary = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  const suggestions: unknown[] = []
  const arrStart = raw.indexOf('[', Math.max(0, raw.indexOf('"suggestions"')))
  if (arrStart >= 0) {
    let depth = 0, objStart = -1
    for (let i = arrStart; i < raw.length; i++) {
      const ch = raw[i]
      if (ch === '{') { if (depth === 0) objStart = i; depth++ }
      else if (ch === '}') { depth--; if (depth === 0 && objStart >= 0) { try { suggestions.push(JSON.parse(raw.slice(objStart, i + 1))) } catch { /* ignora parcial */ } objStart = -1 } }
    }
  }
  return { summary, suggestions }
}
