import type { ReceiptExtractionResult } from './ReceiptExtractionResult.js'
import type { PaymentIntentProps } from './PaymentIntent.js'

export type ValidationRejectionReason =
  | 'approved'
  | 'amount_mismatch'
  | 'date_out_of_window'
  | 'receiver_mismatch'
  | 'invalid_receipt'
  | 'duplicate_transaction'
  | 'low_confidence'
  | 'missing_required_fields'
  | 'payment_method_mismatch'
  | 'invalid_status'
  | 'intent_not_pending'

export interface PaymentValidationDecision {
  approved: boolean
  reason: ValidationRejectionReason
  extracted: ReceiptExtractionResult
  expected: PaymentIntentProps
  checkedAt: Date
  debugInfo?: Record<string, unknown>  // for observability — never sent to user
}
