import type { PackageOffer } from '../domain/pricing/PackageOffer.js'

export interface PackageOfferRepository {
  findById(id: string): Promise<PackageOffer | null>
  findByBotId(botId: string, includeInactive?: boolean): Promise<PackageOffer[]>
  save(offer: PackageOffer): Promise<void>
  delete(id: string): Promise<void>
}
