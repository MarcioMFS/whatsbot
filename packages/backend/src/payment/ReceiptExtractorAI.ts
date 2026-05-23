import type { AIProviderPort } from '@whatsbot/core'
import { parseCurrencyToCentavos, type ReceiptExtractionResult } from '@whatsbot/core'

const EXTRACTION_PROMPT = `You are a Pix receipt OCR and data extraction engine.

Your ONLY job is to extract structured data from the image.
You DO NOT decide if the payment is valid. You DO NOT approve anything.
You ONLY extract and return structured JSON.

Extract the following fields from the receipt image:

{
  "isReceipt": boolean,          // true if this looks like a payment receipt
  "paymentMethod": string|null,  // "PIX", "TED", "boleto", "DOC", or null
  "amount": string|null,         // raw currency string as it appears, e.g. "R$ 15,00"
  "paidAt": string|null,         // ISO 8601 if parseable, else raw date string, else null
  "payerName": string|null,
  "receiverName": string|null,
  "receiverKey": string|null,    // Pix key: phone/CPF/CNPJ/email/random key
  "transactionId": string|null,  // E2E ID, NSU, protocol number, or similar
  "status": string|null,         // e.g. "Concluída", "Pago", "Aprovado"
  "rawText": string|null,        // full text you can read in the image
  "confidence": number           // 0.0-1.0: your confidence in the extraction accuracy
}

Rules:
- If the image is NOT a receipt, set isReceipt=false and confidence to your certainty.
- Do NOT infer or guess fields — if you cannot read it, return null.
- Return ONLY the JSON object, no markdown, no explanation.`

export class ReceiptExtractorAI {
  constructor(private ai: AIProviderPort) {}

  async extract(imageBase64: string): Promise<ReceiptExtractionResult> {
    let raw: string
    try {
      const result = await this.ai.generate({
        systemPrompt: EXTRACTION_PROMPT,
        promptTemplate: 'Extract data from the attached receipt image.',
        history: [],
        userMessage: '',
        variables: {},
        temperature: 0.1,           // low temperature — extraction, not generation
        maxTokens: 600,
        cacheSystemPrompt: true,
        imageBase64,
      })
      raw = result.content.trim()
    } catch (err) {
      console.error('[ReceiptExtractorAI] extraction failed:', err)
      return this.fallback('AI call failed')
    }

    return this.parseRaw(raw)
  }

  private parseRaw(raw: string): ReceiptExtractionResult {
    try {
      // Strip markdown code fences if AI added them despite instructions
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(cleaned)

      const amountCentavos = parsed.amount ? parseCurrencyToCentavos(String(parsed.amount)) : null

      let paidAt: Date | null = null
      if (parsed.paidAt) {
        const d = new Date(parsed.paidAt)
        paidAt = isNaN(d.getTime()) ? null : d
      }

      return {
        isReceipt: Boolean(parsed.isReceipt),
        paymentMethod: parsed.paymentMethod ?? null,
        amountCentavos,
        paidAt,
        payerName: parsed.payerName ?? null,
        receiverName: parsed.receiverName ?? null,
        receiverKey: parsed.receiverKey ?? null,
        transactionId: parsed.transactionId ?? null,
        status: parsed.status ?? null,
        rawText: parsed.rawText ?? null,
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
      }
    } catch {
      return this.fallback(`JSON parse failed. Raw: ${raw.slice(0, 200)}`)
    }
  }

  private fallback(reason: string): ReceiptExtractionResult {
    console.warn('[ReceiptExtractorAI] fallback:', reason)
    return {
      isReceipt: false,
      paymentMethod: null,
      amountCentavos: null,
      paidAt: null,
      payerName: null,
      receiverName: null,
      receiverKey: null,
      transactionId: null,
      status: null,
      rawText: null,
      confidence: 0,
    }
  }
}
