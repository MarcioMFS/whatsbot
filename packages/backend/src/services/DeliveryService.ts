import type { Order, OrderItem, MessagingPort, ConversationEventRepository } from '@whatsbot/core'
import type { PostgreSQLDeliveryAuditRepository } from '../adapters/PostgreSQLDeliveryAuditRepository.js'

export interface DeliveryResult {
  delivered: OrderItem[]
  failed: OrderItem[]
  pending: OrderItem[]
}

export class DeliveryService {
  constructor(
    private messaging: MessagingPort,
    private eventRepo: ConversationEventRepository,
    private auditRepo?: PostgreSQLDeliveryAuditRepository,
  ) {}

  async deliver(
    order: Order,
    phoneNumber: string,
    instanceName: string,
    instanceId?: string,
  ): Promise<DeliveryResult> {
    const delivered: OrderItem[] = []
    const failed: OrderItem[] = []
    const pending: OrderItem[] = []

    for (const item of order.items) {
      if (!item.accessLink) {
        pending.push(item)
        await this.auditRepo?.save({
          orderId: order.id, botId: order.botId, conversationId: order.conversationId,
          phoneNumber, itemName: item.name, status: 'pending_link',
        })
        continue
      }

      try {
        await this.messaging.sendMessage({
          instanceName,
          instanceId,
          phoneNumber,
          message: `🎁 *${item.name}*\n${item.accessLink}`,
        })
        delivered.push(item)
        await this.auditRepo?.save({
          orderId: order.id, botId: order.botId, conversationId: order.conversationId,
          phoneNumber, itemName: item.name, accessLink: item.accessLink,
          status: 'sent', deliveredAt: new Date(),
        })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[DeliveryService] failed to deliver "${item.name}" to ${phoneNumber}:`, errorMessage)
        failed.push(item)
        await this.auditRepo?.save({
          orderId: order.id, botId: order.botId, conversationId: order.conversationId,
          phoneNumber, itemName: item.name, accessLink: item.accessLink,
          status: 'failed', errorMessage,
        })
      }
    }

    if (delivered.length > 0) {
      await this.eventRepo.emit({
        botId: order.botId, conversationId: order.conversationId, phoneNumber,
        eventType: 'delivery_sent',
        payload: { orderId: order.id, delivered: delivered.map(i => i.name), failed: failed.map(i => i.name) },
        occurredAt: new Date(),
      })
    }

    if (pending.length > 0) {
      await this.eventRepo.emit({
        botId: order.botId, conversationId: order.conversationId, phoneNumber,
        eventType: 'delivery_pending',
        payload: { orderId: order.id, pending: pending.map(i => i.name) },
        occurredAt: new Date(),
      })
    }

    if (failed.length > 0) {
      await this.eventRepo.emit({
        botId: order.botId, conversationId: order.conversationId, phoneNumber,
        eventType: 'delivery_failed',
        payload: { orderId: order.id, failed: failed.map(i => i.name) },
        occurredAt: new Date(),
      })
    }

    return { delivered, failed, pending }
  }
}
