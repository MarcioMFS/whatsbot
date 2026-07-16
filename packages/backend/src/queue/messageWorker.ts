import { Worker } from 'bullmq'
import { createHmac, hkdfSync, createDecipheriv } from 'crypto'
import type Redis from 'ioredis'
import type { BotRepository } from '@whatsbot/core'
import type { FlowExecutionService } from '../services/FlowExecutionService.js'
import type { TranscriptionService } from '../services/TranscriptionService.js'
import type { ExternalInboundDispatcher } from '../services/ExternalInboundDispatcher.js'

const MEDIA_KEY_INFO: Record<string, string> = {
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024 // 50MB

// #sec (SSRF): a URL vem do payload do webhook (atacável). Esta função baixa mídia do CDN do WhatsApp,
// então só HTTPS + domínio *.whatsapp.net é permitido — fecha SSRF (sem IP interno/localhost/metadata cloud).
function assertSafeMediaUrl(raw: string): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('invalid media URL') }
  if (u.protocol !== 'https:') throw new Error(`media URL must be https (got ${u.protocol})`)
  const host = u.hostname.toLowerCase()
  if (host !== 'whatsapp.net' && !host.endsWith('.whatsapp.net')) {
    throw new Error(`media host not allowed: ${host}`)
  }
  return u
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

    const safeUrl = assertSafeMediaUrl(url)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 10_000)
    let encBuf: Buffer
    try {
      const res = await fetch(safeUrl, { signal: ac.signal })
      if (!res.ok) throw new Error(`CDN returned ${res.status}`)
      const len = Number(res.headers.get('content-length') ?? 0)
      if (len > MAX_MEDIA_BYTES) throw new Error(`media too large: ${len} bytes`)
      encBuf = Buffer.from(await res.arrayBuffer())
    } finally {
      clearTimeout(timer)
    }

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
  transcriptionService?: TranscriptionService,
  agentRuntime?: { handleIncomingMessage(bot: import('@whatsbot/core').Bot, phone: string, message: string, imageBase64?: string, opts?: { isLastAttempt?: boolean }): Promise<void> },
  externalDispatcher?: ExternalInboundDispatcher,
): Worker {
  const worker = new Worker(
    'messages',
    async (job) => {
      const { botId, phoneNumber, message, msgId, pushName, hasImage, imageMeta, hasAudio, audioMeta, imageBase64: directImageBase64 } = job.data as {
        botId: string
        phoneNumber: string
        message: string
        msgId?: string
        pushName?: string
        hasImage?: boolean
        imageMeta?: { imgMsg: Record<string, unknown> }
        hasAudio?: boolean
        audioMeta?: { audioMsg: Record<string, unknown> }
        imageBase64?: string   // Cloud API: mídia já baixada no webhook (sem decrypt)
      }

      const bot = await botRepo.findById(botId)
      if (!bot) return

      // Per-phone mutex: prevents race conditions when user sends multiple messages rapidly
      const lockKey = `msg:lock:${botId}:${phoneNumber}`
      const lockTTL = 45 // seconds — max time a single message should take to process
      const acquired = await redis.set(lockKey, '1', 'EX', lockTTL, 'NX')
      if (!acquired) {
        // Another job is processing this phone — retry after short delay
        throw Object.assign(new Error(`PHONE_BUSY:${phoneNumber}`), { name: 'PhoneBusy' })
      }

      try {
        let imageBase64: string | undefined = directImageBase64
        if (!imageBase64 && imageMeta?.imgMsg) {
          imageBase64 = await decryptWhatsAppMedia(imageMeta.imgMsg)
          console.log(`[worker] image decrypt: ${imageBase64 ? `OK (${imageBase64.length} chars)` : 'FAILED'}`)
        }

        // Voice note: decrypt audio bytes, transcribe, and treat the transcript as the text message
        let effectiveMessage = message
        if (hasAudio && audioMeta?.audioMsg) {
          const audioB64 = await decryptWhatsAppMedia(audioMeta.audioMsg)
          if (audioB64 && transcriptionService) {
            const mime = (audioMeta.audioMsg.mimetype as string | undefined) ?? 'audio/ogg'
            const transcript = await transcriptionService.transcribe(Buffer.from(audioB64, 'base64'), mime)
            console.log(`[worker] audio transcript: ${transcript ? `"${transcript.slice(0, 80)}"` : 'EMPTY/FAILED'}`)
            if (transcript) effectiveMessage = transcript
          } else {
            console.log(`[worker] audio decrypt: ${audioB64 ? 'OK but no transcription service' : 'FAILED'}`)
          }
        }

        if (!effectiveMessage.trim()) return

        // Onda 3 — canal ao vivo: runtime='external' encaminha a msg pro handler externo
        // (ex.: Vox) e entrega a resposta de volta. NÃO roda flow/agent. Gate estrito em
        // runtime==='external' → zero impacto nos bots que vendem (flow/agent).
        if (bot.globalConfig?.runtime === 'external' && externalDispatcher) {
          await externalDispatcher.dispatch(bot, phoneNumber, effectiveMessage, { imageBase64, hasImage: hasImage ?? !!imageBase64 })
          return
        }

        // v2 runtime branch: agent (tool-calling) vs flow (legacy graph)
        // Whitelist override: numero de teste cai no agente mesmo com runtime='flow' (testa em prod sem afetar clientes reais)
        const testNumbers = bot.globalConfig?.agentTestNumbers ?? []
        const phoneTail = (p: string) => p.replace(/\D/g, '').slice(-8) // tolera 55 (pais) e o 9 extra do movel BR
        const incomingTail = phoneTail(phoneNumber)
        const isTestNumber = incomingTail.length === 8 && testNumbers.some((n) => phoneTail(n) === incomingTail)
        const runtimeAgent = bot.globalConfig?.runtime === 'agent' || isTestNumber
        // Funil roteirizado por keyword convive com runtime='agent': se a msg abre
        // (ou continua) uma conversa de flow com trigger 'keyword', vai pro motor de
        // flow mesmo em bot-agente. Fora isso, zero mudança no caminho do agente.
        const keywordFunnel = runtimeAgent
          ? await flowExecService.shouldHandleViaKeywordFlow(bot, phoneNumber, effectiveMessage)
          : false
        if (keywordFunnel) {
          console.log(`[worker] keyword_funnel_over_agent bot=${bot.id} phone=${phoneNumber}`)
        }
        const useAgent = runtimeAgent && !keywordFunnel
        if (useAgent && agentRuntime) {
          // última tentativa? então o agente faz fallback (handoff). Senão, erro transitório
          // re-lança e o BullMQ re-processa sozinho (cliente não precisa "acordar" o bot).
          const isLastAttempt = job.attemptsMade >= ((job.opts.attempts ?? 1) - 1)
          await agentRuntime.handleIncomingMessage(bot, phoneNumber, effectiveMessage, imageBase64, { isLastAttempt })
        } else {
          await flowExecService.handleIncomingMessage(bot, phoneNumber, effectiveMessage, imageBase64, { msgId, hasImage: hasImage ?? !!imageBase64, pushName })
        }
      } finally {
        await redis.del(lockKey)
      }
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
