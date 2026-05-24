import type { Cart } from '../catalog/Cart.js'
import type { PackageOffer, PricingMode } from './PackageOffer.js'

/**
 * PricingService — Pure domain service. No I/O, no side effects.
 *
 * Receives the Cart and active PackageOffers, calculates the best applicable price.
 * PackageOffer does NOT know about Products — it only sees the cart count.
 * Product is always the delivery source of truth.
 */
export interface PricingResult {
  originalTotalCentavos: number
  finalTotalCentavos: number
  discountCentavos: number
  appliedOfferId: string | null
  appliedOfferName: string | null
  pricingMode: PricingMode | null
  itemCount: number
}

export class PricingService {
  static calculateFromCount(count: number, unitPriceCentavos: number, offers: PackageOffer[]): PricingResult {
    const originalTotal = count * unitPriceCentavos
    const noDiscount: PricingResult = {
      originalTotalCentavos: originalTotal,
      finalTotalCentavos: originalTotal,
      discountCentavos: 0,
      appliedOfferId: null,
      appliedOfferName: null,
      pricingMode: null,
      itemCount: count,
    }
    if (count === 0 || offers.length === 0) return noDiscount
    const active = offers
      .filter(o => o.isActive && o.type === 'quantity_bundle')
      .sort((a, b) => b.quantity - a.quantity)
    let best: PackageOffer | null = null
    for (const offer of active) {
      if (offer.pricingMode === 'exact_quantity' && count === offer.quantity) { best = offer; break }
      if (offer.pricingMode === 'minimum_quantity' && offer.quantity <= count) { best = offer; break }
    }
    if (!best) return noDiscount
    return {
      originalTotalCentavos: originalTotal,
      finalTotalCentavos: best.priceCentavos,
      discountCentavos: Math.max(0, originalTotal - best.priceCentavos),
      appliedOfferId: best.id,
      appliedOfferName: best.name,
      pricingMode: best.pricingMode,
      itemCount: count,
    }
  }

  static calculate(cart: Cart, offers: PackageOffer[]): PricingResult {
    const itemCount = cart.count
    const originalTotal = cart.totalCentavos

    const noDiscount: PricingResult = {
      originalTotalCentavos: originalTotal,
      finalTotalCentavos: originalTotal,
      discountCentavos: 0,
      appliedOfferId: null,
      appliedOfferName: null,
      pricingMode: null,
      itemCount,
    }

    if (itemCount === 0 || offers.length === 0) return noDiscount

    // R1: only quantity_bundle
    const active = offers
      .filter(o => o.isActive && o.type === 'quantity_bundle')
      .sort((a, b) => b.quantity - a.quantity) // largest bracket first

    let best: PackageOffer | null = null

    for (const offer of active) {
      if (offer.pricingMode === 'exact_quantity' && itemCount === offer.quantity) {
        best = offer
        break
      }
      if (offer.pricingMode === 'minimum_quantity' && offer.quantity <= itemCount) {
        best = offer
        break
      }
    }

    if (!best) return noDiscount

    return {
      originalTotalCentavos: originalTotal,
      finalTotalCentavos: best.priceCentavos,
      discountCentavos: Math.max(0, originalTotal - best.priceCentavos),
      appliedOfferId: best.id,
      appliedOfferName: best.name,
      pricingMode: best.pricingMode,
      itemCount,
    }
  }

  static formatBRL(centavos: number): string {
    return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`
  }

  static toPricingVars(result: PricingResult): Record<string, string> {
    return {
      __rt_checkout_original_total: String(result.originalTotalCentavos),
      __rt_checkout_original_total_brl: PricingService.formatBRL(result.originalTotalCentavos),
      __rt_checkout_final_total: String(result.finalTotalCentavos),
      __rt_checkout_final_total_brl: PricingService.formatBRL(result.finalTotalCentavos),
      __rt_checkout_discount: String(result.discountCentavos),
      __rt_checkout_discount_brl: PricingService.formatBRL(result.discountCentavos),
      __rt_checkout_applied_offer: result.appliedOfferName ?? '',
      __rt_checkout_item_count: String(result.itemCount),
    }
  }
}
