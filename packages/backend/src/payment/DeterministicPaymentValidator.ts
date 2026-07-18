import type { ReceiptExtractionResult } from '@whatsbot/core'
import type { PaymentIntentProps } from '@whatsbot/core'
import type { PaymentValidationDecision, ValidationRejectionReason } from '@whatsbot/core'

// Statuses the Pix ecosystem uses to signal a completed transfer
const VALID_COMPLETED_STATUSES = [
  'completed', 'paid', 'concluido', 'concluída', 'efetivado',
  'aprovado', 'pago', 'confirmed', 'realizado', 'sucesso',
]

// Status que indicam transferência NÃO concluída — só rejeitamos quando o status
// existe e é ruim. Muitos comprovantes reais (ex.: Nubank) não trazem palavra de
// status nenhuma: o documento "Comprovante de transferência" já implica concluída,
// e as regras fortes (valor, chave, data, duplicidade) continuam valendo.
const INVALID_STATUSES = [
  'pendente', 'pending', 'agendad', 'schedul', 'recusad', 'negad',
  'devolvid', 'cancelad', 'estornad', 'em processamento', 'processing',
  'falh', 'failed', 'rejected', 'expirad',
]

const MIN_CONFIDENCE = 0.85

// 10 minutes tolerance for clock skew / delayed screenshots
const MAX_FUTURE_TOLERANCE_MS = 10 * 60 * 1000

// Allow receipts up to 12 hours BEFORE the PaymentIntent was created.
// Covers: (1) user does PIX earlier and sends receipt later, (2) timezone skew when AI
// extracts local BR time (UTC-3 to UTC-5) but we compare against UTC intentCreatedAt.
const PRE_INTENT_TOLERANCE_MS = 12 * 60 * 60 * 1000

// Maximum age tolerance for receipts without a timestamp (same-day only)
const SAME_DAY_GRACE_HOURS = 24

/**
 * ALL payment decisions go through here. Zero IA involvement.
 *
 * Input:  ReceiptExtractionResult (from AI layer) + PaymentIntent (source of truth)
 * Output: PaymentValidationDecision with approved=true/false + reason
 *
 * Rules run in short-circuit order — cheapest checks first.
 */
export class DeterministicPaymentValidator {
  validate(
    extracted: ReceiptExtractionResult,
    intent: PaymentIntentProps,
    isTransactionAlreadyUsed: boolean,
    isReceiptFingerprintUsed: boolean,
  ): PaymentValidationDecision {
    const base = { extracted, expected: intent, checkedAt: new Date() }
    const reject = (reason: ValidationRejectionReason, debugInfo?: Record<string, unknown>): PaymentValidationDecision =>
      ({ ...base, approved: false, reason, debugInfo })

    // ── Rule 1: must be an actual receipt ──────────────────────────────────
    if (!extracted.isReceipt) {
      return reject('invalid_receipt', { confidence: extracted.confidence })
    }

    // ── Rule 2: must be PIX ────────────────────────────────────────────────
    const method = extracted.paymentMethod?.trim().toUpperCase() ?? ''
    if (method !== 'PIX') {
      return reject('payment_method_mismatch', { got: method, expected: 'PIX' })
    }

    // ── Rule 3: confidence threshold ──────────────────────────────────────
    if (extracted.confidence < MIN_CONFIDENCE) {
      return reject('low_confidence', { confidence: extracted.confidence, threshold: MIN_CONFIDENCE })
    }

    // ── Rule 4: required fields ────────────────────────────────────────────
    const hasReceiver = !!(extracted.receiverName || extracted.receiverKey)
    if (extracted.amountCentavos == null || !hasReceiver) {
      return reject('missing_required_fields', {
        hasAmount: extracted.amountCentavos != null,
        hasReceiver,
      })
    }

    // ── Rule 5: intent must still be pending ──────────────────────────────
    if (intent.status !== 'pending') {
      return reject('intent_not_pending', { intentStatus: intent.status })
    }

    // ── Rule 6: amount check — pagou IGUAL ou A MAIS aprova ───────────────
    // Igualdade exata rejeitava cliente que arredonda pra cima (caso real 18/07:
    // R$ 20,00 num pix de R$ 19,90 → "não consegui confirmar"). A MENOS segue
    // rejeitando (amount_mismatch) com a diferença no debug pro alerta do dono.
    if (extracted.amountCentavos < intent.amount) {
      return reject('amount_mismatch', {
        extracted: extracted.amountCentavos,
        expected: intent.amount,
        diffCentavos: extracted.amountCentavos - intent.amount,
      })
    }

    // ── Rule 7: date validation ────────────────────────────────────────────
    const dateCheck = this.validateDate(extracted.paidAt, intent.createdAt)
    if (!dateCheck.ok) {
      return reject('date_out_of_window', dateCheck.debug)
    }

    // ── Rule 8: receiver match ─────────────────────────────────────────────
    if (!this.matchesReceiver(extracted, intent)) {
      return reject('receiver_mismatch', {
        extractedKey: extracted.receiverKey,
        extractedName: extracted.receiverName,
        expectedKey: intent.receiverKey,
        expectedName: intent.receiverName,
      })
    }

    // ── Rule 9: status ─────────────────────────────────────────────────────
    // Rejeita apenas status explicitamente ruim. Ausente/desconhecido passa
    // (comprovantes Nubank etc. não trazem status), positivo passa.
    const statusNorm = extracted.status?.toLowerCase().trim() ?? ''
    const isBadStatus = statusNorm !== '' &&
      !VALID_COMPLETED_STATUSES.some(s => statusNorm.includes(s)) &&
      INVALID_STATUSES.some(s => statusNorm.includes(s))
    if (isBadStatus) {
      return reject('invalid_status', { status: extracted.status })
    }

    // ── Rule 10: duplicate transactionId ──────────────────────────────────
    if (isTransactionAlreadyUsed) {
      return reject('duplicate_transaction', { transactionId: extracted.transactionId })
    }

    // ── Rule 11: duplicate receipt fingerprint ────────────────────────────
    if (isReceiptFingerprintUsed) {
      return reject('duplicate_transaction', { source: 'fingerprint' })
    }

    return { ...base, approved: true, reason: 'approved' }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private validateDate(
    paidAt: Date | null,
    intentCreatedAt: Date,
  ): { ok: boolean; debug?: Record<string, unknown> } {
    const now = Date.now()
    const createdAt = intentCreatedAt.getTime()

    if (paidAt) {
      const paid = paidAt.getTime()
      // Allow receipts up to 15min before intent (user may have initiated PIX before hitting checkout)
      if (paid < createdAt - PRE_INTENT_TOLERANCE_MS) {
        return { ok: false, debug: { reason: 'receipt_older_than_intent', paidAt, intentCreatedAt } }
      }
      if (paid > now + MAX_FUTURE_TOLERANCE_MS) {
        return { ok: false, debug: { reason: 'receipt_from_future', paidAt, toleranceMs: MAX_FUTURE_TOLERANCE_MS } }
      }
      return { ok: true }
    }

    // No timestamp — accept only if intentCreatedAt is today (UTC)
    const createdDay = new Date(intentCreatedAt).toISOString().slice(0, 10)
    const todayDay = new Date().toISOString().slice(0, 10)
    if (createdDay !== todayDay) {
      return { ok: false, debug: { reason: 'no_timestamp_and_not_same_day', createdDay, todayDay } }
    }
    return { ok: true }
  }

  private matchesReceiver(extracted: ReceiptExtractionResult, intent: PaymentIntentProps): boolean {
    // Key match: normalize both (strip punctuation, lowercase)
    if (extracted.receiverKey) {
      const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
      if (norm(extracted.receiverKey) === norm(intent.receiverKey)) return true
    }

    // Name match: at least first token of expected name appears in extracted name
    if (extracted.receiverName) {
      const expectedFirst = intent.receiverName.split(' ')[0].toLowerCase()
      if (extracted.receiverName.toLowerCase().includes(expectedFirst)) return true
    }

    return false
  }

  /** Build a stable fingerprint from extracted receipt for dedup purposes */
  buildFingerprint(extracted: ReceiptExtractionResult): string {
    const parts = [
      extracted.transactionId ?? '',
      String(extracted.amountCentavos ?? ''),
      extracted.receiverKey ?? '',
      extracted.paidAt?.toISOString().slice(0, 16) ?? '', // minute precision
    ]
    // Simple deterministic hash — not cryptographic, just for dedup
    return parts.join('|').replace(/\s/g, '').toLowerCase()
  }
}
