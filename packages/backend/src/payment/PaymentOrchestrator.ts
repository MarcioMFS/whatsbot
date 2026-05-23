import type {
  PaymentIntentRepository,
  UsedTransactionRepository,
  MessagingPort,
} from '@whatsbot/core'
import type { InternalEventBus } from '../events/InternalEventBus.js'
import { ReceiptExtractorAI } from './ReceiptExtractorAI.js'
import { DeterministicPaymentValidator } from './DeterministicPaymentValidator.js'
import type { PaymentValidationDecision } from '@whatsbot/core'

export interface PaymentOrchestratorResult {
  decision: PaymentValidationDecision
  userMessage: string     // message to send back to the user
  shouldConfirm: boolean  // true = call conversation.phase → post_purchase_support
}

/**
 * Orchestrates the full receipt validation pipeline:
 *   image → extraction → deterministic validation → event emission → result
 *
 * Deliberately stateless — callers (FlowExecutor) pass all required context.
 */
export class PaymentOrchestrator {
  private validator = new DeterministicPaymentValidator()

  constructor(
    private extractor: ReceiptExtractorAI,
    private paymentIntentRepo: PaymentIntentRepository,
    private usedTransactionRepo: UsedTransactionRepository,
    private eventBus: InternalEventBus,
  ) {}

  async processReceipt(params: {
    botId: string
    conversationId: string
    phoneNumber: string
    imageBase64: string
    paymentIntentId: string
  }): Promise<PaymentOrchestratorResult> {
    const { botId, conversationId, phoneNumber, imageBase64, paymentIntentId } = params

    // ── Step 1: Load PaymentIntent ────────────────────────────────────────
    const intent = await this.paymentIntentRepo.findById(paymentIntentId)
    if (!intent) {
      throw new Error(`PaymentIntent ${paymentIntentId} not found`)
    }

    intent.incrementAttempt()
    await this.paymentIntentRepo.save(intent)

    await this.eventBus.emit({
      type: 'receipt_received',
      botId,
      conversationId,
      phoneNumber,
      paymentIntentId,
      attemptCount: intent.attemptCount,
      occurredAt: new Date(),
    })

    // ── Step 2: AI extraction (extract only, never decides) ───────────────
    const extracted = await this.extractor.extract(imageBase64)

    // ── Step 3: Duplicate checks ──────────────────────────────────────────
    const isTransactionUsed = extracted.transactionId
      ? await this.usedTransactionRepo.isUsed(botId, extracted.transactionId)
      : false

    const fingerprint = this.validator.buildFingerprint(extracted)
    const isFingerprintUsed = await this.usedTransactionRepo.isFingerprintUsed(botId, fingerprint)

    // ── Step 4: Deterministic validation ─────────────────────────────────
    const decision = this.validator.validate(
      extracted,
      intent.toJSON(),
      isTransactionUsed,
      isFingerprintUsed,
    )

    // ── Step 5: Emit validation event ─────────────────────────────────────
    await this.eventBus.emit({
      type: 'receipt_validated',
      botId,
      conversationId,
      phoneNumber,
      paymentIntentId,
      decision,
      occurredAt: new Date(),
    })

    // ── Step 6: Handle decision ───────────────────────────────────────────
    if (decision.approved) {
      const transactionId = extracted.transactionId ?? `manual_${Date.now()}`

      intent.markPaid(transactionId)
      await this.paymentIntentRepo.save(intent)

      await this.usedTransactionRepo.markUsed(botId, transactionId, paymentIntentId, fingerprint)

      await this.eventBus.emit({
        type: 'payment_approved',
        botId,
        conversationId,
        phoneNumber,
        paymentIntentId,
        transactionId,
        amountCentavos: intent.amount,
        occurredAt: new Date(),
      })

      return {
        decision,
        userMessage: '✅ Pagamento confirmado! Obrigado pela sua compra.',
        shouldConfirm: true,
      }
    }

    // Rejected — build user-friendly message by reason
    await this.eventBus.emit({
      type: 'payment_rejected',
      botId,
      conversationId,
      phoneNumber,
      paymentIntentId,
      reason: decision.reason,
      attemptCount: intent.attemptCount,
      occurredAt: new Date(),
    })

    return {
      decision,
      userMessage: this.rejectionMessage(decision.reason),
      shouldConfirm: false,
    }
  }

  private rejectionMessage(reason: PaymentValidationDecision['reason']): string {
    const messages: Record<string, string> = {
      invalid_receipt: 'Não consegui identificar um comprovante Pix nessa imagem. Pode enviar novamente?',
      payment_method_mismatch: 'O comprovante precisa ser de uma transferência Pix. Por favor, envie o comprovante correto.',
      low_confidence: 'A imagem está difícil de ler. Pode enviar uma foto mais nítida?',
      missing_required_fields: 'O comprovante não contém todas as informações necessárias. Por favor, envie o comprovante completo.',
      amount_mismatch: 'O valor no comprovante não corresponde ao valor da compra. Por favor, verifique e envie o comprovante correto.',
      date_out_of_window: 'O comprovante parece ser de uma data anterior. Por favor, envie o comprovante do pagamento realizado agora.',
      receiver_mismatch: 'Os dados do recebedor no comprovante não correspondem. Verifique se pagou para a chave correta.',
      invalid_status: 'O status do comprovante indica que a transferência não foi concluída.',
      duplicate_transaction: 'Este comprovante já foi utilizado anteriormente.',
      intent_not_pending: 'Este pagamento já foi processado.',
    }
    return messages[reason] ?? 'Não foi possível validar o comprovante. Por favor, tente novamente.'
  }
}
