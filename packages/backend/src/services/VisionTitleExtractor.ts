import type { AIProviderPort } from '@whatsbot/core'

const EXTRACTION_PROMPT = `You read an image a customer sent on WhatsApp. The customer is trying to identify a
series / novela / drama / movie they want to buy. Read ALL visible text: on-screen title cards,
captions, watermarks, app UI, file names — anything legible.

Return ONLY JSON, no markdown, no explanation:
{
  "titles": string[],   // every distinct series/movie title you can read, most prominent first. [] if none.
  "confidence": number  // 0.0-1.0
}

Rules:
- Extract the TITLE TEXT exactly as written. Do NOT translate. Do NOT guess from a scene with no text.
- If the image is just a scene/photo with no readable title, return "titles": [].
- A list/grid may contain several titles — return each separately.
- Return ONLY the JSON object.`

/**
 * Vision step for "stray" images (a customer sends a screenshot/poster of a series).
 * Extracts the visible title(s) so they can be fed into the existing CatalogSearchService.
 * Uses the same Claude vision path as ReceiptExtractorAI. Never throws — returns [] on failure.
 */
export class VisionTitleExtractor {
  constructor(private ai: AIProviderPort) {}

  async extract(imageBase64: string): Promise<string[]> {
    let raw: string
    try {
      const result = await this.ai.generate({
        systemPrompt: EXTRACTION_PROMPT,
        promptTemplate: 'Extract the series/movie title(s) visible in the attached image.',
        history: [],
        userMessage: '',
        variables: {},
        temperature: 0.1,
        maxTokens: 300,
        cacheSystemPrompt: true,
        imageBase64,
      })
      raw = result.content.trim()
    } catch (err) {
      console.warn('[VisionTitleExtractor] AI call failed:', err instanceof Error ? err.message : err)
      return []
    }

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed.titles)) return []
      return parsed.titles
        .map((t: unknown) => String(t).trim())
        .filter((t: string) => t.length > 0)
        .slice(0, 5)
    } catch {
      console.warn('[VisionTitleExtractor] JSON parse failed. Raw:', raw.slice(0, 160))
      return []
    }
  }
}
