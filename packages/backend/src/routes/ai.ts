import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AIGenerationService } from '../services/AIGenerationService.js'

const GenerateSchema = z.object({
  description: z.string().min(10).max(5000),
  language: z.string().default('en'),
  provider: z.enum(['claude', 'groq']).default('groq'),
})

interface AICtx {
  aiService: AIGenerationService
}

const META_PROMPT = `Você é especialista em montar BOTS DE VENDA no WhatsApp que CONVERTEM. A partir da descrição de um produto/serviço (pode ser o texto colado de uma landing page), gere a configuração de um bot VENDEDOR.

Retorne SOMENTE um objeto JSON cru (sem markdown, sem cercas) com EXATAMENTE esta estrutura:
{"productName":"...","persona":"...","systemPrompt":"...","suggestedFlow":[{"type":"...","description":"..."}],"welcomeMessage":"..."}

PLAYBOOK DE VENDA — o systemPrompt DEVE codificar estas regras (é o que faz vender):
- Sinal de compra ("quero","quanto","como pago","tem?") => AJA: apresente a oferta / gere o próximo passo. NÃO empilhe argumentos com quem já quer.
- Micro-compromisso: ofereça ESCOLHA em vez de sim/não; reafirme o "sim" antes de cobrar ("então é X por R$Y, fechado?").
- Objeção (ARC): Reconhece -> responde curto e honesto -> volta pra ação. "tá caro" => reforça valor / oferece a opção mais acessível (NUNCA invente desconto). "vou pensar" => sonda o bloqueio real.
- Espelhe o tom/tamanho/emoji do cliente a cada mensagem; diante de raiva mantenha a calma; NUNCA espelhe grosseria.
- Urgência só VERDADEIRA (a real do produto: oferta do dia, garantia) — nunca invente prazo nem contagem regressiva.
- AJA, não prometa: toda ação anunciada acontece no mesmo turno; se falta dado, pergunte.
- Use prova social / garantia / bônus / preço REAIS da descrição. NUNCA invente fato. Nunca exponha erro técnico.

REGRAS DE SAÍDA:
- productName: 2-4 palavras (o nome do produto).
- persona: 1 frase — quem o bot é (nome + tom) coerente com o público do produto.
- systemPrompt: instruções COMPLETAS do bot vendedor (longo, várias frases separadas por ponto, SEM quebra de linha crua): o que ele vende usando os diferenciais/preço/garantia/bônus REAIS da descrição; como conduzir a venda seguindo o PLAYBOOK acima; o que NUNCA fazer (inventar preço/prazo/garantia, expor erro). Termine com a frase "Sempre responda em <idioma do bot>.".
- welcomeMessage: a 1a mensagem que ABRE a venda — calorosa, ancora o valor/oferta e conduz pro próximo passo.
- suggestedFlow: os ESTÁGIOS de venda (entre 5 e 8): abertura, apresentar valor/prova social, oferta+preço, quebrar objeção, fechar/pagamento, entrega, recuperação. Cada item {"type","description"}.
- SEM quebras de linha cruas dentro de strings (separe por ". "). Saída SÓ o JSON, nada mais.`

export async function aiRoutes(app: FastifyInstance, ctx: AICtx) {
  app.addHook('preHandler', async (req) => {
    await req.jwtVerify()
  })

  // #sec: rate-limit dedicado nesta rota cara (chamada LLM). Antes só o global 100/min por IP — um user
  // disparava geração à vontade (DoS financeiro). 10/min por IP nesta rota.
  app.post('/generate-bot-config', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = GenerateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const { description, language, provider } = parsed.data

    try {
      const result = await ctx.aiService.generate(provider, {
        systemPrompt: META_PROMPT,
        promptTemplate: `Descrição do produto/serviço (pode ser texto de landing page):\n${description}\n\nIdioma do bot: ${language}\n\nGere o JSON da configuração do bot vendedor agora.`,
        history: [],
        userMessage: '',
        variables: {},
        temperature: 0.4,
        maxTokens: 3000,
        cacheSystemPrompt: true,
      })

      // Strip markdown code fences if present
      const stripped = result.content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '')
      const jsonMatch = stripped.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return reply.code(500).send({ error: 'AI did not return valid JSON' })

      let config: unknown
      try {
        config = JSON.parse(jsonMatch[0])
      } catch {
        // Last resort: find the last valid closing brace
        const raw = jsonMatch[0]
        for (let i = raw.length - 1; i >= 0; i--) {
          if (raw[i] === '}') {
            try { config = JSON.parse(raw.slice(0, i + 1)); break } catch { /* continue */ }
          }
        }
        if (!config) return reply.code(500).send({ error: 'AI returned malformed JSON', raw: jsonMatch[0].slice(0, 500) })
      }
      return reply.send(config)
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'AI generation failed' })
    }
  })
}
