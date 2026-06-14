import type { AIGenerationService } from './AIGenerationService.js'

// Escape hatch — a rede de IA por descrição. Quando a mensagem sai do roteiro,
// decide UMA de 4 ações e devolve o controle ao fluxo. Ver Brain/spec_escape_hatch.md.
// Regra-mãe: a IA responde/roteia/escala — NUNCA inventa fato fora do conhecimento.

export interface EscapeRoute {
  handle: string        // pra onde rotear (handle de saída do nó / entrada da parte)
  description: string   // o que essa rota faz — a IA lê pra decidir
}

export interface EscapeInput {
  message: string
  history: string             // conversa recente (já formatada)
  knowledge: string           // agentKnowledge do bot (fonte de verdade)
  routes: EscapeRoute[]       // opções de roteamento disponíveis
  allowAnswer: boolean        // pode responder em lugar? (false = só rotear/escalar)
  hint?: string               // dica de "quando sair do roteiro" (por parte)
}

export interface EscapeDecision {
  action: 'answer' | 'route' | 'handoff' | 'unknown'
  reply?: string              // texto quando action=answer
  handle?: string             // rota quando action=route
}

const PROVIDER = 'groq' as const  // barato: 1 chamada curta por mensagem fora-do-roteiro

export class EscapeHatchService {
  constructor(private ai: AIGenerationService) {}

  async decide(input: EscapeInput): Promise<EscapeDecision> {
    if (!this.ai.getAvailableProviders().includes(PROVIDER)) {
      return { action: 'unknown' }   // sem provider → deixa o fluxo tratar
    }

    const routesTxt = input.routes.map(r => `- ${r.handle}: ${r.description}`).join('\n') || '(nenhuma rota)'
    const systemPrompt = [
      'Você é a rede de segurança de um bot de WhatsApp que segue um roteiro.',
      'A mensagem do cliente NÃO encaixou no passo atual do roteiro. Decida o que fazer com ela.',
      'Escolha UMA ação:',
      input.allowAnswer
        ? '- "answer": responder uma dúvida/objeção curta AGORA (1 mensagem) usando SÓ o conhecimento abaixo; depois o roteiro continua.'
        : '- (answer DESABILITADO nesta parte — não use)',
      '- "route": a mensagem pertence a outra parte do fluxo → escolha o handle correspondente.',
      '- "handoff": reclamação, fraude, pedido de humano, ou algo fora do escopo → passa pra um atendente.',
      '- "unknown": você não tem como ajudar com segurança.',
      'NUNCA invente fato que não esteja no conhecimento. NUNCA prometa o que não sabe. Não reescreva o roteiro.',
      input.hint ? `Dica do dono pra esta parte: ${input.hint}` : '',
      '',
      'Conhecimento (única fonte de verdade):',
      input.knowledge || '(vazio)',
      '',
      'Rotas disponíveis (handle: o que faz):',
      routesTxt,
      '',
      'Responda APENAS JSON: {"action":"answer|route|handoff|unknown","reply":"<se answer>","handle":"<se route>"}',
    ].filter(Boolean).join('\n')

    try {
      const r = await this.ai.generate(PROVIDER, {
        systemPrompt,
        promptTemplate: `Conversa recente:\n${input.history}\n\nMensagem atual: "${input.message}"`,
        history: [],
        userMessage: input.message,
        variables: {},
        temperature: 0.2,
        maxTokens: 300,
      })
      return this.parse(r.content, input)
    } catch {
      return { action: 'unknown' }
    }
  }

  private parse(raw: string, input: EscapeInput): EscapeDecision {
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1) return { action: 'unknown' }
    let p: { action?: string; reply?: string; handle?: string }
    try { p = JSON.parse(raw.slice(start, end + 1)) } catch { return { action: 'unknown' } }

    const action = p.action
    if (action === 'answer' && input.allowAnswer && typeof p.reply === 'string' && p.reply.trim()) {
      return { action: 'answer', reply: p.reply.trim() }
    }
    if (action === 'route' && typeof p.handle === 'string' && input.routes.some(r => r.handle === p.handle)) {
      return { action: 'route', handle: p.handle }
    }
    if (action === 'handoff') return { action: 'handoff' }
    return { action: 'unknown' }
  }
}
