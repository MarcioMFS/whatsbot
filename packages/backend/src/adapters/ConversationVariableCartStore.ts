import { Cart } from '@whatsbot/core'
import type { CartStore } from '@whatsbot/core'
import type { ConversationRepository } from '@whatsbot/core'

export class ConversationVariableCartStore implements CartStore {
  constructor(private convRepo: ConversationRepository) {}

  async load(conversationId: string): Promise<Cart> {
    const conv = await this.convRepo.findById(conversationId)
    if (!conv) return Cart.empty()
    return Cart.fromVariables(conv.variables)
  }

  async save(conversationId: string, cart: Cart): Promise<void> {
    const conv = await this.convRepo.findById(conversationId)
    if (!conv) return
    const vars = cart.toVariables()
    for (const [k, v] of Object.entries(vars)) {
      conv.setVariable(k, v)
    }
    await this.convRepo.save(conv)
  }

  async clear(conversationId: string): Promise<void> {
    const conv = await this.convRepo.findById(conversationId)
    if (!conv) return
    for (const key of Cart.clearKeys()) {
      conv.setVariable(key, '')
    }
    await this.convRepo.save(conv)
  }
}
