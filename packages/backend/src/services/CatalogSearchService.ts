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

// Extract individual product title candidates from formatted list messages
// e.g. "Oi! Quero: • 99 Amuleto, 99 Desilusões" → ["99 Amuleto", "99 Desilusões"]
function extractListItems(message: string): string[] {
  // Split by bullet points and newlines first
  const byBullets = message.split(/[•\n;]+/).map(s => s.trim()).filter(s => s.length > 2)

  // Flatten by commas within each segment
  const parts: string[] = []
  for (const seg of byBullets) {
    const byComma = seg.split(',').map(s => s.trim()).filter(s => s.length > 2)
    parts.push(...byComma)
  }

  // Keep only title-like parts: start with a digit or have a meaningful capitalized word (>3 chars)
  const filler = /^(ola|oi|ola!|oi!|quero|gostaria|preciso|queria|comprar|dessas|desses|das|dos|series|minisseries|titulos|seguintes|estes|esses|abaixo|favor|por|me|da|de|do|a|o|e|eu|nao|sim|ok|tudo|bem|bom|boa)$/i
  const titleLike = parts.filter(p => {
    const clean = p.replace(/^[^a-z0-9]+/i, '').trim()
    if (clean.length < 3) return false
    if (/^\d/.test(clean)) return true
    const words = clean.split(/\s+/)
    return words.some(w => w.length > 3 && !filler.test(w))
  })

  return titleLike.length > 1 ? titleLike : []
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
    // Step 0: extract individual list items from formatted messages ("• A, B" or "A\nB")
    const listItems = extractListItems(userMessage)
    if (listItems.length > 1) {
      return this.searchMultiple(botId, listItems)
    }

    const normalized = normalizeText(userMessage)

    // Step 1-4: direct DB search (exact → alias → fuzzy → reverse-contains)
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

  private async searchMultiple(botId: string, items: string[]): Promise<CatalogSearchResult> {
    const found: CatalogSearchResult['products'] = []
    const unresolved: string[] = []
    const seenIds = new Set<string>()

    for (const item of items) {
      const normalized = normalizeText(item)
      const results = await this.productRepo.search(botId, normalized, 3)
      const product = results[0] ?? null
      if (product && !seenIds.has(product.id)) {
        seenIds.add(product.id)
        found.push({ product, confidence: 0.85, searchQuery: item })
      } else if (!product) {
        unresolved.push(item)
      }
    }

    // AI resolution for unresolved items
    if (unresolved.length > 0) {
      const allProducts = await this.productRepo.findByBotId(botId)
      if (allProducts.length > 0) {
        const catalogList = allProducts
          .map(p => `- ${p.name} (id: ${p.id})`)
          .join('\n')
        try {
          const response = await this.aiService.generate('groq', {
            systemPrompt: 'You are a product name extractor. Return ONLY valid JSON, nothing else.',
            promptTemplate: `Catalog:\n${catalogList}\n\nUnresolved items: ${JSON.stringify(unresolved)}\n\nMatch each item to a product. Return JSON: {"matches": [{"query": "item", "productId": "id or null"}]}`,
            history: [],
            userMessage: unresolved.join(', '),
            variables: {},
            temperature: 0.1,
            maxTokens: 300,
          })
          const parsed = JSON.parse(response.content)
          const matches: Array<{ query: string; productId: string | null }> = parsed.matches ?? []
          const stillUnresolved: string[] = []
          for (const m of matches) {
            if (m.productId) {
              const product = allProducts.find(p => p.id === m.productId) ?? null
              if (product && !seenIds.has(product.id)) {
                seenIds.add(product.id)
                found.push({ product, confidence: 0.75, searchQuery: m.query })
                continue
              }
            }
            stillUnresolved.push(m.query)
          }
          return { products: found, unresolved: stillUnresolved }
        } catch {
          // AI failed — return what we have
        }
      }
    }

    return { products: found, unresolved }
  }
}
