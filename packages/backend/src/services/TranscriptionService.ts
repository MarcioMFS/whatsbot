import Groq, { toFile } from 'groq-sdk'

/**
 * Speech-to-text for incoming WhatsApp voice notes (PTT, ogg/opus).
 * Uses Groq Whisper — same API keys / rotation strategy as GroqAdapter.
 * Returns '' on any failure so the caller can degrade gracefully (never throws).
 */
export class TranscriptionService {
  private clients: Groq[]
  private currentIndex = 0

  constructor(apiKeys: string | string[]) {
    const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys]
    this.clients = keys.map(k => new Groq({ apiKey: k }))
  }

  /** Transcribe raw audio bytes. `mimetype` only drives the filename extension. */
  async transcribe(audio: Buffer, mimetype = 'audio/ogg'): Promise<string> {
    if (!this.clients.length) return ''
    const ext = mimetype.includes('mpeg') ? 'mp3'
      : mimetype.includes('mp4') || mimetype.includes('m4a') ? 'm4a'
      : mimetype.includes('wav') ? 'wav'
      : 'ogg'

    let lastError: unknown
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const client = this.clients[this.currentIndex]
      try {
        const file = await toFile(audio, `audio.${ext}`, { type: mimetype })
        const res = await client.audio.transcriptions.create({
          file,
          model: 'whisper-large-v3-turbo',
          language: 'pt',
          response_format: 'json',
          temperature: 0,
        })
        return (res.text ?? '').trim()
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status
        if (status === 429 || status === 503) {
          console.warn(`[TranscriptionService] key[${this.currentIndex}] rate limited (${status}), rotating`)
          this.currentIndex = (this.currentIndex + 1) % this.clients.length
          lastError = err
          continue
        }
        console.warn('[TranscriptionService] failed:', err instanceof Error ? err.message : err)
        return ''
      }
    }
    console.warn('[TranscriptionService] all keys exhausted:', lastError instanceof Error ? lastError.message : lastError)
    return ''
  }
}
