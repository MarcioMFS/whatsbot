import type { Order, OrderItem, MessagingPort, ConversationEventRepository } from '@whatsbot/core'

export interface DeliveryResult {
  delivered: OrderItem[]
  pending: OrderItem[]
}

export class DeliveryService {
  constructor(
    private messaging: MessagingPort,
    private eventRepo: ConversationEventRepository,
  ) {}

  async deliver(
    order: Order,
    phoneNumber: string,
    instanceName: string,
    instanceId?: string,
  ): Promise<DeliveryResult> {
    const delivered: OrderItem[] = []
    const pending: OrderItem[] = []

    for (const item of order.items) {
      if (item.accessLink) {
        await this.messaging.sendMessage({
          instanceName,
          instanceId,
          phoneNumber,
          message: `🎁 *${item.name}*\n${item.accessLink}`,
        })
        delivered.push(item)
      } else {
        pending.push(item)
      }
    }

    if (delivered.length > 0) {
      await this.eventRepo.emit({
        botId: order.botId,
        conversationId: order.conversationId,
        phoneNumber,
        eventType: 'delivery_sent',
        payload: { orderId: order.id, delivered: delivered.map(i => i.name) },
        occurredAt: new Date(),
      })
    }

    if (pending.length > 0) {
      await this.eventRepo.emit({
        botId: order.botId,
        conversationId: order.conversationId,
        phoneNumber,
        eventType: 'delivery_pending',
        payload: { orderId: order.id, pending: pending.map(i => i.name) },
        occurredAt: new Date(),
      })
    }

    return { delivered, pending }
  }
}
