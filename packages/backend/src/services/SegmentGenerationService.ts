import { randomUUID } from 'crypto'
import type { Flow, FlowSegment, FlowNode } from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'

// Gera segmentos descritos a partir dos nós de um flow (modelo C: IA propõe, humano revisa).
// NÃO persiste — devolve uma proposta com generated:true. Ver Brain/spec_skills_segmentos.md.
export class SegmentGenerationService {
  constructor(private ai: AIGenerationService) {}

  async generate(flow: Flow): Promise<FlowSegment[]> {
    const nodes = flow.nodes
    if (nodes.length === 0) return []

    const summary = nodes.map(n => this.describeNode(n)).join('\n')
    const validIds = new Set(nodes.map(n => n.id))

    const systemPrompt = [
      'Você organiza fluxos de atendimento de WhatsApp em SEGMENTOS (capacidades) descritos.',
      'Cada segmento agrupa nós que servem ao mesmo propósito de negócio (ex: Boas-vindas, Catálogo, Pagamento PIX, Validação de comprovante, Suporte/Handoff, Encerramento).',
      'Para cada segmento escreva: name (curto, em PT-BR), description (o QUE faz, 1-2 frases, claro pra uma IA decidir usar), whenToUse (QUANDO acionar), nodeIds (ids exatos dos nós que pertencem).',
      'Use SOMENTE os ids fornecidos. Todo nó deve cair em no máximo um segmento; nós utilitários (delay) podem ficar de fora.',
      'Responda APENAS um JSON: {"segments":[{"name","description","whenToUse","nodeIds":[]}]}. Sem texto fora do JSON.',
    ].join('\n')

    // Builder/Improver: roda na cadeia FREE (NVIDIA→Groq), nunca no provider pago — preserva o budget.
    const result = await this.ai.generateBuilder({
      systemPrompt,
      promptTemplate: `Flow "${flow.name}". Nós (id · tipo · rótulo · trecho):\n${summary}`,
      history: [],
      userMessage: 'Gere os segmentos deste flow.',
      variables: {},
      temperature: 0.2,
      maxTokens: 2000,
    })

    return this.parse(result.content, validIds)
  }

  private describeNode(n: FlowNode): string {
    const data = n.data as Record<string, unknown>
    const label = (data.label as string) ?? '—'
    const snippet =
      (data.message as string) ??
      (data.systemPrompt as string) ??
      (data.confirmationMessage as string) ??
      (data.timeoutMessage as string) ??
      ''
    const clean = snippet.replace(/\s+/g, ' ').slice(0, 90)
    return `- ${n.id} · ${n.type} · ${label}${clean ? ` · "${clean}"` : ''}`
  }

  private parse(raw: string, validIds: Set<string>): FlowSegment[] {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1) return []
    let parsed: { segments?: unknown }
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return []
    }
    const arr = Array.isArray(parsed.segments) ? parsed.segments : []
    return arr
      .map((s): FlowSegment | null => {
        const seg = s as Record<string, unknown>
        const name = typeof seg.name === 'string' ? seg.name.trim() : ''
        const description = typeof seg.description === 'string' ? seg.description.trim() : ''
        if (!name || !description) return null
        const nodeIds = Array.isArray(seg.nodeIds)
          ? (seg.nodeIds as unknown[]).filter((id): id is string => typeof id === 'string' && validIds.has(id))
          : []
        return {
          id: randomUUID(),
          name,
          description,
          whenToUse: typeof seg.whenToUse === 'string' ? seg.whenToUse.trim() : undefined,
          nodeIds,
          generated: true,
        }
      })
      .filter((s): s is FlowSegment => s !== null)
  }
}
