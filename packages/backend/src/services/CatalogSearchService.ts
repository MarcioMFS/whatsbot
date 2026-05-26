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

// Words that alone can never form a product title — pure navigation/filler
const NAV_WORDS = new Set([
  'entao', 'então', 'me', 'mostre', 'mostra', 'mostrar', 'outras', 'outros', 'outra', 'outro',
  'ai', 'aí', 'por', 'favor', 'mais', 'ver', 'ver', 'opcoes', 'opçoes', 'opcao', 'opção',
  'series', 'serie', 'então', 'que', 'tem', 'voce', 'você', 'qual', 'quais', 'pode',
  'lista', 'como', 'assim', 'disponivel', 'disponiveis', 'ai', 'hm', 'ok', 'tudo', 'bem',
  'so', 'só', 'todas', 'todos', 'esse', 'essa', 'esses', 'essas', 'por', 'nao', 'não',
  'e', 'de', 'da', 'do', 'as', 'os', 'a', 'o', 'um', 'uma', 'uns', 'umas',
  'no', 'na', 'nos', 'nas', 'pra', 'para', 'com', 'sem', 'sim', 'aqui',
  'quero', 'queria', 'gostaria', 'preciso', 'busco', 'procuro',
])

const STOP = new Set(['o','a','os','as','e','de','do','da','dos','das','em','no','na','nos','nas','um','uma','com','que','se','por','para','ao','aos','eu','meu','minha','seu','sua'])

// Returns true if message is purely navigational with no product title content
function isPureNavigation(message: string): boolean {
  const words = normalizeText(message).split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return true
  return words.every(w => NAV_WORDS.has(w))
}

function computeWordOverlap(queryNorm: string, productNameNorm: string): { overlap: number; threshold: number; passed: boolean } {
  const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  const nameWords = productNameNorm.split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  const overlap = queryWords.filter(w => nameWords.some(nw => nw.includes(w) || w.includes(nw))).length
  const threshold = Math.min(2, Math.ceil(nameWords.length * 0.4))
  return { overlap, threshold, passed: overlap >= threshold }
}

// Extract individual product title candidates from formatted list messages
// e.g. "Oi! Quero: • 99 Amuleto, 99 Desilusões" → ["99 Amuleto", "99 Desilusões"]
function extractListItems(message: string): string[] {
  const byBullets = message.split(/[•\n;]+/).map(s => s.trim()).filter(s => s.length > 2)
  const parts: string[] = []
  for (const seg of byBullets) {
    const byComma = seg.split(',').map(s => s.trim()).filter(s => s.length > 2)
    parts.push(...byComma)
  }
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
    const tag = `[CatalogSearch] originalQuery="${userMessage.slice(0, 80)}"`

    // Pure navigation — no title content
    if (isPureNavigation(userMessage)) {
      console.log(`${tag} decision=not_found reason=pure_navigation`)
      return { products: [], unresolved: [userMessage] }
    }

    // Multi-item list
    const listItems = extractListItems(userMessage)
    if (listItems.length > 1) {
      // #3 multipleTitlesDetected log
      console.log(`${tag} decision=ambiguous reason=multi_item multipleTitlesDetected=${listItems.length} items=${JSON.stringify(listItems)}`)
      return this.searchMultiple(botId, listItems)
    }

    const normalized = normalizeText(userMessage)

    // Step 1: DB fuzzy search
    const directResults = await this.productRepo.search(botId, normalized, 10)
    const fuzzyCandidates = directResults.map(p => p.name)
    console.log(`${tag} fuzzyCandidates=${JSON.stringify(fuzzyCandidates)}`)

    if (directResults.length > 0) {
      const scored = directResults.map(p => {
        const nameNorm = normalizeText(p.name)
        const exact = nameNorm === normalized
        const wo = computeWordOverlap(normalized, nameNorm)
        return { p, exact, wo }
      })

      const filtered = scored.filter(({ exact, wo }) => exact || wo.passed)

      // #3 Log each candidate with its overlap score + semantic candidates
      for (const { p, exact, wo } of scored) {
        console.log(`${tag} candidate="${p.name}" wordOverlap=${wo.overlap}/${wo.threshold} passed=${exact || wo.passed}${exact ? ' (exact)' : ''}`)
      }

      // #3 Semantic candidates structured log
      console.log(`${tag} semanticCandidates=${JSON.stringify(scored.map(s => ({ name: s.p.name, overlap: s.wo.overlap, threshold: s.wo.threshold, passed: s.exact || s.wo.passed })))}`)

      if (filtered.length > 0) {
        const best = filtered[0]
        console.log(`${tag} finalQueryUsed="${normalized}" finalMatchedProduct="${best.p.name}" decision=fuzzy_match`)
        return {
          products: filtered.map(({ p, exact }) => ({
            product: p,
            confidence: exact ? 1.0 : 0.8,
            searchQuery: normalized,
          })),
          unresolved: [],
        }
      }

      console.log(`${tag} fuzzy found ${directResults.length} candidates but all failed word-overlap — escalating to AI`)
    } else {
      console.log(`${tag} fuzzy returned 0 results — escalating to AI`)
    }

    // Step 2: AI fallback
    const allProducts = await this.productRepo.findByBotId(botId)
    if (allProducts.length === 0) {
      console.log(`${tag} decision=not_found reason=empty_catalog`)
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
      // #3 aiRecommendationCandidates structured log
      console.log(`${tag} aiExtractedTitles=${JSON.stringify(aiCandidates.map(c => c.query))}`)
      console.log(`${tag} aiRecommendationCandidates=${JSON.stringify(aiCandidates.map(c => ({ query: c.query, productId: c.productId ?? null })))} tokens=${response.inputTokens}/${response.outputTokens}`)
    } catch (err) {
      console.log(`${tag} decision=not_found reason=ai_parse_error err=${err instanceof Error ? err.message : err}`)
      return { products: [], unresolved: [userMessage] }
    }

    const found: CatalogSearchResult['products'] = []
    const unresolved: string[] = []

    for (const candidate of aiCandidates) {
      let product: Product | null = null

      if (candidate.productId) {
        product = allProducts.find(p => p.id === candidate.productId) ?? null
      }

      if (!product) {
        const results = await this.productRepo.search(botId, normalizeText(candidate.query), 1)
        product = results[0] ?? null
      }

      if (product) {
        console.log(`${tag} aiExtractedTitle="${candidate.query}" finalMatchedProduct="${product.name}" decision=ai_extracted_match`)
        found.push({ product, confidence: 0.75, searchQuery: candidate.query })
      } else {
        console.log(`${tag} aiExtractedTitle="${candidate.query}" decision=not_found reason=ai_candidate_no_db_match`)
        unresolved.push(candidate.query)
      }
    }

    if (found.length === 0 && aiCandidates.length === 0) {
      console.log(`${tag} decision=not_found reason=ai_returned_no_candidates`)
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
        console.log(`[CatalogSearch] multi item="${item}" finalMatchedProduct="${product.name}" decision=fuzzy_match`)
        found.push({ product, confidence: 0.85, searchQuery: item })
      } else if (!product) {
        unresolved.push(item)
      }
    }

    if (unresolved.length > 0) {
      const allProducts = await this.productRepo.findByBotId(botId)
      if (allProducts.length > 0) {
        const catalogList = allProducts.map(p => `- ${p.name} (id: ${p.id})`).join('\n')
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
                console.log(`[CatalogSearch] multi ai item="${m.query}" finalMatchedProduct="${product.name}" decision=ai_extracted_match`)
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
