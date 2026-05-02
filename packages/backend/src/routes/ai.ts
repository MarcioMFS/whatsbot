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

const META_PROMPT = `You are an expert chatbot designer. Given a product/service description, generate a bot configuration.

Return ONLY a raw JSON object (no markdown, no code fences) with exactly this structure:
{"productName":"...","persona":"...","systemPrompt":"...","suggestedFlow":[{"type":"trigger","description":"..."},{"type":"text_message","description":"..."},{"type":"ai_response","description":"..."}],"welcomeMessage":"..."}

Rules:
- productName: 2-4 words
- persona: one short sentence
- systemPrompt: 2-4 sentences max, specific to the product, include what the bot should NOT do, end with "Always respond in [language]."
- suggestedFlow: exactly 3 items
- welcomeMessage: one friendly sentence
- No newlines inside string values — use spaces instead
- Output ONLY the JSON, nothing else`

export async function aiRoutes(app: FastifyInstance, ctx: AICtx) {
  app.addHook('preHandler', async (req) => {
    await req.jwtVerify()
  })

  app.post('/generate-bot-config', async (req, reply) => {
    const parsed = GenerateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const { description, language, provider } = parsed.data

    try {
      const result = await ctx.aiService.generate(provider, {
        systemPrompt: META_PROMPT,
        promptTemplate: `Product/Service Description:\n${description}\n\nLanguage to use in the bot: ${language}\n\nGenerate the bot configuration JSON now.`,
        history: [],
        userMessage: '',
        variables: {},
        temperature: 0.4,
        maxTokens: 2048,
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
