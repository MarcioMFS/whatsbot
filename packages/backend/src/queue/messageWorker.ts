import { Worker } from 'bullmq'
import type Redis from 'ioredis'
import type { BotRepository } from '@whatsbot/core'
import type { FlowExecutionService } from '../services/FlowExecutionService.js'

export function startMessageWorker(
  redis: Redis,
  flowExecService: FlowExecutionService,
  botRepo: BotRepository,
): Worker {
  const worker = new Worker(
    'messages',
    async (job) => {
      const { botId, phoneNumber, message } = job.data as {
        botId: string
        phoneNumber: string
        message: string
      }

      const bot = await botRepo.findById(botId)
      if (!bot) return

      await flowExecService.handleIncomingMessage(bot, phoneNumber, message)
    },
    {
      connection: { ...redis.options, maxRetriesPerRequest: null },
      concurrency: 10,
    }
  )

  worker.on('failed', (job, err) => {
    console.error(`Message job ${job?.id} failed:`, err.message)
  })

  return worker
}
