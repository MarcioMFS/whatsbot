import { Cart, PricingService, PaymentIntent } from '@whatsbot/core'
import type { AgentTool, ToolContext, ToolResult } from './types.js'

// ── search_catalog (safe) ──────────────────────────────────────────────────────
const searchCatalog: AgentTool = {
  name: 'search_catalog',
  description: 'Busca séries/títulos no catálogo por nome (tolera erro de escrita). Use sempre que o cliente mencionar uma série. Retorna preço — nunca invente preço.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'nome da série que o cliente quer' } }, required: ['query'] },
  guarded: false,
  async execute(input, ctx): Promise<ToolResult> {
    const query = String(input.query ?? '').trim()
    if (!query) return { success: false, code: 'EMPTY_QUERY', message: 'query vazia' }
    const res = await ctx.services.catalogSearchService.search(ctx.bot.id, query, {
      botId: ctx.bot.id, conversationId: ctx.conversation.id, phoneNumber: ctx.conversation.phoneNumber,
    })
    const products = res.products.map(p => ({ id: p.product.id, name: p.product.name, priceBRL: PricingService.formatBRL(p.product.priceCentavos), confidence: p.confidence }))
    return { success: products.length > 0, code: products.length ? 'OK' : 'NOT_FOUND', data: { products, unresolved: res.unresolved }, confidence: products[0]?.confidence }
  },
}

// ── add_to_cart (safe) ─────────────────────────────────────────────────────────
const addToCart: AgentTool = {
  name: 'add_to_cart',
  description: 'Adiciona um produto ao carrinho. Use o productId retornado por search_catalog.',
  inputSchema: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
  guarded: false,
  async execute(input, ctx): Promise<ToolResult> {
    const productId = String(input.productId ?? '')
    const product = await ctx.services.productRepo.findById(productId)
    if (!product) return { success: false, code: 'NOT_FOUND', message: 'produto não existe' }
    const cart = Cart.fromVariables(ctx.conversation.variables)
    cart.addItem({ productId: product.id, name: product.name, priceCentavos: product.priceCentavos, accessLink: product.accessLink })
    for (const [k, v] of Object.entries(cart.toVariables())) ctx.conversation.setVariable(k, v)
    // Total JÁ com pacote/desconto — mesmo cálculo do cart_summary/generate_pix.
    // (antes devolvia cart.totalInBRL cru → carrinho dizia R$12 e o PIX cobrava R$10 do pacote)
    const offers = await ctx.services.packageOfferRepo.findByBotId(ctx.bot.id)
    const pricing = PricingService.calculate(cart, offers)
    return { success: true, code: 'OK', data: {
      itemAdded: product.name,
      cartCount: cart.count,
      cartTotalBRL: PricingService.formatBRL(pricing.finalTotalCentavos),
      discountBRL: PricingService.formatBRL(pricing.discountCentavos),
      appliedOffer: pricing.appliedOfferName,
    } }
  },
}

// ── cart_summary (safe) ────────────────────────────────────────────────────────
const cartSummary: AgentTool = {
  name: 'cart_summary',
  description: 'Retorna o conteúdo do carrinho e o total (já com pacote/desconto aplicado).',
  inputSchema: { type: 'object', properties: {} },
  guarded: false,
  async execute(_input, ctx): Promise<ToolResult> {
    const cart = Cart.fromVariables(ctx.conversation.variables)
    if (cart.isEmpty) return { success: true, code: 'EMPTY', data: { items: [], totalBRL: 'R$ 0,00' } }
    const offers = await ctx.services.packageOfferRepo.findByBotId(ctx.bot.id)
    const pricing = PricingService.calculate(cart, offers)
    return { success: true, code: 'OK', data: { items: cart.toSummaryLines(), count: cart.count, totalBRL: PricingService.formatBRL(pricing.finalTotalCentavos), discountBRL: PricingService.formatBRL(pricing.discountCentavos), appliedOffer: pricing.appliedOfferName } }
  },
}

// ── generate_pix (GUARDED) ─────────────────────────────────────────────────────
const generatePix: AgentTool = {
  name: 'generate_pix',
  description: 'Gera a cobrança PIX do carrinho atual. NÃO aceita valor — o preço vem sempre do carrinho. Use quando o cliente confirmar que quer pagar.',
  inputSchema: { type: 'object', properties: {} },   // sem amount — invariante
  guarded: true,
  policyKey: 'can_generate_pix',
  async execute(_input, ctx): Promise<ToolResult> {
    const cart = Cart.fromVariables(ctx.conversation.variables)
    if (cart.isEmpty) return { success: false, code: 'EMPTY_CART', message: 'carrinho vazio — adicione um produto antes' }
    const receiverKey = ctx.bot.globalConfig?.defaultPixKey
    if (!receiverKey) return { success: false, code: 'NO_PIX_KEY', message: 'bot sem chave PIX configurada' }

    const offers = await ctx.services.packageOfferRepo.findByBotId(ctx.bot.id)
    const pricing = PricingService.calculate(cart, offers)
    for (const [k, v] of Object.entries(PricingService.toPricingVars(pricing))) ctx.conversation.setVariable(k, v)

    // Idempotência: se já existe um PIX PENDENTE desta conversa pelo MESMO valor, reusa.
    // Garante que re-tentativa de mensagem (ou cliente pedindo o PIX de novo) NÃO duplica a cobrança.
    let intent = await ctx.services.paymentIntentRepo.findPendingByConversation(ctx.conversation.id)
    if (!intent || intent.amount !== pricing.finalTotalCentavos) {
      // INVARIANTE: valor vem do pricing, nunca do input do modelo
      intent = PaymentIntent.create({
        botId: ctx.bot.id,
        leadId: ctx.lead?.id ?? ctx.conversation.phoneNumber,
        conversationId: ctx.conversation.id,
        amount: pricing.finalTotalCentavos,
        receiverKey,
        receiverName: ctx.bot.globalConfig?.defaultReceiverName ?? '',
        expiresAt: new Date(Date.now() + (ctx.bot.globalConfig?.defaultPaymentExpirationMinutes ?? 60) * 60_000),
      })
      await ctx.services.paymentIntentRepo.save(intent)
    }
    ctx.conversation.setVariable('__rt_checkout_payment_id', intent.id)
    ctx.conversation.setVariable('__rt_checkout_pix_key', receiverKey)
    ctx.conversation.setVariable('__rt_checkout_final_total_brl', PricingService.formatBRL(pricing.finalTotalCentavos))
    ctx.conversation.setPhase('awaiting_payment')
    return { success: true, code: 'PIX_GENERATED', data: { pixKey: receiverKey, amountBRL: PricingService.formatBRL(pricing.finalTotalCentavos), paymentIntentId: intent.id } }
  },
}

// ── validate_proof (GUARDED, determinístico) ───────────────────────────────────
const validateProof: AgentTool = {
  name: 'validate_proof',
  description: 'Valida o comprovante de pagamento enviado pelo cliente. A confirmação é determinística — você NÃO decide se o pagamento é válido, a tool decide.',
  inputSchema: { type: 'object', properties: {} },
  guarded: true,
  policyKey: 'can_validate_proof',
  async execute(_input, ctx): Promise<ToolResult> {
    const paymentIntentId = ctx.conversation.variables['__rt_checkout_payment_id']
    if (!paymentIntentId) return { success: false, code: 'NO_PENDING_PAYMENT', message: 'nenhum PIX gerado ainda' }
    if (!ctx.imageBase64) return { success: false, code: 'NO_IMAGE', message: 'nenhuma imagem de comprovante recebida nesta mensagem' }
    const result = await ctx.services.paymentOrchestrator.processReceipt({
      botId: ctx.bot.id, conversationId: ctx.conversation.id, phoneNumber: ctx.conversation.phoneNumber,
      imageBase64: ctx.imageBase64, paymentIntentId,
    })
    if (result.decision.approved) {
      ctx.conversation.setVariable('__validation_approved', 'true')
      ctx.conversation.setPhase('payment_confirmed')
    }
    return {
      success: result.decision.approved,
      code: result.decision.approved ? 'PAYMENT_CONFIRMED' : 'PROOF_INVALID',
      message: result.userMessage,
      data: { reason: result.decision.reason },
      confidence: result.decision.extracted?.confidence,
    }
  },
}

// ── deliver_access (GUARDED) ───────────────────────────────────────────────────
const deliverAccess: AgentTool = {
  name: 'deliver_access',
  description: 'Entrega os links de acesso das séries compradas. Só funciona após o pagamento confirmado.',
  inputSchema: { type: 'object', properties: {} },
  guarded: true,
  policyKey: 'can_deliver_access',
  async execute(_input, ctx): Promise<ToolResult> {
    // INVARIANTE: só entrega se pagamento confirmado
    if (ctx.conversation.variables['__validation_approved'] !== 'true' && ctx.conversation.phase !== 'payment_confirmed') {
      return { success: false, code: 'NOT_CONFIRMED', message: 'pagamento ainda não confirmado — não pode entregar' }
    }
    const cart = Cart.fromVariables(ctx.conversation.variables)
    ctx.conversation.setPhase('post_purchase')
    return { success: true, code: 'DELIVERED', data: { accessLinks: cart.accessLinks } }
  },
}

// ── human_handoff ──────────────────────────────────────────────────────────────
const humanHandoff: AgentTool = {
  name: 'human_handoff',
  description: 'Transfere a conversa para um atendente humano. Use em reclamação, fraude, ou pedido explícito.',
  inputSchema: { type: 'object', properties: { reason: { type: 'string' } } },
  guarded: true,
  policyKey: 'can_transfer_human',
  async execute(input, ctx): Promise<ToolResult> {
    ctx.conversation.handoff()
    return { success: true, code: 'HANDOFF', message: 'transferido para humano', data: { reason: input.reason } }
  },
}

export const AGENT_TOOLS: AgentTool[] = [
  searchCatalog, addToCart, cartSummary, generatePix, validateProof, deliverAccess, humanHandoff,
]
