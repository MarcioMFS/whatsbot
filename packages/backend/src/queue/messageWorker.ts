import { Worker } from 'bullmq'
import { createHmac, hkdfSync, createDecipheriv } from 'crypto'
import type Redis from 'ioredis'
import type { BotRepository } from '@whatsbot/core'
import type { FlowExecutionService } from '../services/FlowExecutionService.js'

const MEDIA_KEY_INFO: Record<string, string> = {
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
}

async function decryptWhatsAppMedia(imgMsg: Record<string, unknown>): Promise<string | undefined> {
  try {
    const url = imgMsg.URL as string | undefined
    const mediaKeyB64 = imgMsg.mediaKey as string | undefined
    const mimetype = (imgMsg.mimetype as string | undefined) ?? 'image/jpeg'

    if (!url || !mediaKeyB64) {
      console.warn('[decryptWhatsAppMedia] missing URL or mediaKey')
      return undefined
    }

    const mediaType = mimetype.startsWith('video') ? 'video'
      : mimetype.startsWith('audio') ? 'audio'
      : mimetype.startsWith('application') ? 'document'
      : 'image'

    const info = MEDIA_KEY_INFO[mediaType] ?? 'WhatsApp Image Keys'

    const res = await fetch(url)
    if (!res.ok) throw new Error(`CDN returned ${res.status}`)
    const encBuf = Buffer.from(await res.arrayBuffer())

    // HKDF-SHA256: salt = 32 zero bytes, expand to 112 bytes
    const mediaKey = Buffer.from(mediaKeyB64, 'base64')
    const salt = Buffer.alloc(32, 0)
    const derived = Buffer.from(hkdfSync('sha256', mediaKey, salt, info, 112))

    const iv = derived.subarray(0, 16)
    const cipherKey = derived.subarray(16, 48)
    const macKey = derived.subarray(48, 80)

    // Last 10 bytes = MAC, rest = ciphertext
    const ciphertext = encBuf.subarray(0, encBuf.length - 10)
    const mac = encBuf.subarray(encBuf.length - 10)

    // Verify MAC (HMAC-SHA256 of iv + ciphertext, truncated to 10 bytes)
    const expectedMac = createHmac('sha256', macKey).update(iv).update(ciphertext).digest().subarray(0, 10)
    if (!expectedMac.equals(mac)) {
      console.warn('[decryptWhatsAppMedia] MAC mismatch — proceeding anyway')
    }

    // AES-256-CBC decrypt
    const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    return decrypted.toString('base64')
  } catch (err) {
    console.warn('[decryptWhatsAppMedia] failed:', err instanceof Error ? err.message : err)
    return undefined
  }
}

export function startMessageWorker(
  redis: Redis,
  flowExecService: FlowExecutionService,
  botRepo: BotRepository,
): Worker {
  const worker = new Worker(
    'messages',
    async (job) => {
      const { botId, phoneNumber, message, imageMeta } = job.data as {
        botId: string
        phoneNumber: string
        message: string
        imageMeta?: { imgMsg: Record<string, unknown> }
      }

      const bot = await botRepo.findById(botId)
      if (!bot) return

      let imageBase64: string | undefined
      if (imageMeta?.imgMsg) {
        imageBase64 = await decryptWhatsAppMedia(imageMeta.imgMsg)
        console.log(`[worker] image decrypt: ${imageBase64 ? `OK (${imageBase64.length} chars)` : 'FAILED'}`)
      }

      await flowExecService.handleIncomingMessage(bot, phoneNumber, message, imageBase64)
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
