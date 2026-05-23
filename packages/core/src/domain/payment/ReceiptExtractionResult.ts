/**
 * Output of the AI receipt extraction layer.
 * The AI ONLY extracts and structures — never decides.
 * All amounts normalized to centavos (integer).
 */
export interface ReceiptExtractionResult {
  isReceipt: boolean
  paymentMethod: string | null      // "PIX", "TED", "boleto", "DOC"
  amountCentavos: number | null     // R$15,00 → 1500 (integer)
  paidAt: Date | null               // parsed ISO or null
  payerName: string | null
  receiverName: string | null
  receiverKey: string | null        // Pix key as-is from receipt
  transactionId: string | null      // E2E ID, NSU, or protocol
  status: string | null             // "completed", "pago", "efetivado" etc
  rawText: string | null            // full OCR text for audit
  confidence: number                // 0..1 — AI self-reported confidence
}

/** Parse currency strings to centavos integer. Exported for testing. */
export function parseCurrencyToCentavos(raw: string): number | null {
  if (!raw) return null
  // Remove currency symbol, whitespace, "R$", "BRL"
  const cleaned = raw.replace(/[R$\sBRL]/gi, '').trim()
  // Handle both comma-decimal "15,00" and dot-decimal "15.00"
  // "1.500,00" (BR thousands) → 1500.00
  let normalized: string
  if (/^\d{1,3}(\.\d{3})+(,\d{2})?$/.test(cleaned)) {
    // BR format: 1.500,00
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    // Assume dot-decimal or plain
    normalized = cleaned.replace(',', '.')
  }
  const float = parseFloat(normalized)
  if (isNaN(float) || float < 0) return null
  return Math.round(float * 100)
}
