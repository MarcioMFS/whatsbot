import type { Product } from '@whatsbot/core'
import type { ProductRepository } from '@whatsbot/core'
import type { AIGenerationService } from './AIGenerationService.js'

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

function isAmbiguous(message: string): boolean {
  const words = message.trim().split(/\s+/)
  const hasMultipleCommas = (message.match(/,/g) ?? []).length >= 1
  const hasAndConjunction = /\be\b|\band\b/i.test(message)
  return words.length > 3 || hasMultipleCommas || hasAndConjunction
}

export interface CatalogSearchResult {
  products: Array<{ product: Product; confidence: number; searchQuery: string }>
  unresolved: string[]
}

export class CatalogSearchService {
  constructor(
    private productRepo: ProductRepository,
    private aiService: AIGenerationService,
  ) {}

  async search(botId: string, userMessage: string): Promise<CatalogSearchResult> {
    const normalized = normalizeText(userMessage)

    // Step 1-4: direct DB search (exact → alias → fuzzy)
    const directResults = await this.productRepo.search(botId, normalized, 10)

    if (directResults.length > 0) {
      return {
        products: directResults.map(p => ({
          product: p,
          confidence: normalizeText(p.name) === normalized ? 1.0 : 0.8,
          searchQuery: normalized,
        })),
        unresolved: [],
      }
    }

    // Step 5: AI fallback — only for ambiguous or multi-product messages
    if (!isAmbiguous(userMessage)) {
      return { products: [], unresolved: [userMessage] }
    }

    const allProducts = await this.productRepo.findByBotId(botId)
    if (allProducts.length === 0) {
      return { products: [], unresolved: [userMessage] }
    }

    const catalogList = allProducts
      .map(p => `- ${p.name} (id: ${p.id}, aliases: ${p.aliases.join(', ')})`)
      .join('\n')

    let aiCandidates: Array<{ query: string; productId?: string }> = []
    try {
      const response = await this.aiService.generate('groq', {
        systemPrompt: 'You are a product name extractor. Return ONLY valid JSON, nothing else.',
        promptTemplate: `Given catalog:\n${catalogList}\n\nMessage: "{{userMessage}}"\n\nExtract product names the customer wants to buy. Return JSON: {"candidates": [{"query": "name", "productId": "id or null"}]}`,
        history: [],
        userMessage,
        variables: { userMessage },
        temperature: 0.1,
        maxTokens: 300,
      })
      const parsed = JSON.parse(response.content)
      aiCandidates = parsed.candidates ?? []
    } catch {
      return { products: [], unresolved: [userMessage] }
    }

    const found: CatalogSearchResult['products'] = []
    const unresolved: string[] = []

    for (const candidate of aiCandidates) {
      // AI never resolves final — always validate against catalog
      let product: Product | null = null

      if (candidate.productId) {
        product = allProducts.find(p => p.id === candidate.productId) ?? null
      }

      if (!product) {
        const results = await this.productRepo.search(botId, normalizeText(candidate.query), 1)
        product = results[0] ?? null
      }

      if (product) {
        found.push({ product, confidence: 0.75, searchQuery: candidate.query })
      } else {
        unresolved.push(candidate.query)
      }
    }

    return { products: found, unresolved }
  }
}
