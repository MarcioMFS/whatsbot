/**
 * DeterministicPaymentValidator — antifraude test suite
 *
 * Each test validates exactly one rule, in isolation.
 * Zero AI calls — pure deterministic logic.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeterministicPaymentValidator } from '../payment/DeterministicPaymentValidator.js'
import { parseCurrencyToCentavos } from '@whatsbot/core'
import type { ReceiptExtractionResult } from '@whatsbot/core'
import type { PaymentIntentProps } from '@whatsbot/core'

const validator = new DeterministicPaymentValidator()

// ── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date()
const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)

function makeIntent(overrides: Partial<PaymentIntentProps> = {}): PaymentIntentProps {
  return {
    id: 'intent-001',
    botId: 'bot-001',
    leadId: 'lead-001',
    conversationId: 'conv-001',
    amount: 1500,                      // R$ 15,00
    receiverKey: '11999999999',
    receiverName: 'Maria Silva',
    createdAt: tenMinAgo,
    expiresAt: null,
    status: 'pending',
    transactionId: null,
    attemptCount: 0,
    metadata: {},
    ...overrides,
  }
}

function makeReceipt(overrides: Partial<ReceiptExtractionResult> = {}): ReceiptExtractionResult {
  return {
    isReceipt: true,
    paymentMethod: 'PIX',
    amountCentavos: 1500,
    paidAt: now,
    payerName: 'João Comprador',
    receiverName: 'Maria Silva',
    receiverKey: '11999999999',
    transactionId: 'E0001234567890',
    status: 'Concluída',
    rawText: 'Pix enviado com sucesso',
    confidence: 0.92,
    ...overrides,
  }
}

// ── parseCurrencyToCentavos ───────────────────────────────────────────────────

test('parseCurrencyToCentavos: R$ 15,00', () => {
  assert.equal(parseCurrencyToCentavos('R$ 15,00'), 1500)
})

test('parseCurrencyToCentavos: R$1.500,00', () => {
  assert.equal(parseCurrencyToCentavos('R$1.500,00'), 150000)
})

test('parseCurrencyToCentavos: 15.00', () => {
  assert.equal(parseCurrencyToCentavos('15.00'), 1500)
})

test('parseCurrencyToCentavos: invalid', () => {
  assert.equal(parseCurrencyToCentavos('abc'), null)
})

// ── Validator: happy path ─────────────────────────────────────────────────────

test('approve: all fields match', () => {
  const d = validator.validate(makeReceipt(), makeIntent(), false, false)
  assert.equal(d.approved, true)
  assert.equal(d.reason, 'approved')
})

// ── Antifraud rules ───────────────────────────────────────────────────────────

test('reject: not a receipt', () => {
  const d = validator.validate(makeReceipt({ isReceipt: false }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'invalid_receipt')
})

test('reject: not PIX', () => {
  const d = validator.validate(makeReceipt({ paymentMethod: 'TED' }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'payment_method_mismatch')
})

test('reject: low confidence', () => {
  const d = validator.validate(makeReceipt({ confidence: 0.7 }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'low_confidence')
})

test('reject: missing amount', () => {
  const d = validator.validate(makeReceipt({ amountCentavos: null }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'missing_required_fields')
})

// Pagou A MAIS aprova (caso real 18/07: R$20,00 num pix de R$19,90 era rejeitado)
test('approve: pagou a mais (R$16 num pix de R$15)', () => {
  const d = validator.validate(makeReceipt({ amountCentavos: 1600 }), makeIntent(), false, false)
  assert.equal(d.approved, true)
})

test('approve: pagou 1 centavo a mais', () => {
  const d = validator.validate(makeReceipt({ amountCentavos: 1501 }), makeIntent(), false, false)
  assert.equal(d.approved, true)
})

test('reject: pagou A MENOS (R$14,90 num pix de R$15)', () => {
  const d = validator.validate(makeReceipt({ amountCentavos: 1490 }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'amount_mismatch')
  assert.equal((d.debugInfo as Record<string, unknown>)['diffCentavos'], -10)
})

test('reject: receipt older than payment intent', () => {
  const veryOld = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const d = validator.validate(makeReceipt({ paidAt: veryOld }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'date_out_of_window')
})

test('reject: receipt from the future', () => {
  const future = new Date(Date.now() + 30 * 60 * 1000) // +30min
  const d = validator.validate(makeReceipt({ paidAt: future }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'date_out_of_window')
})

test('reject: receiver name mismatch', () => {
  const d = validator.validate(
    makeReceipt({ receiverName: 'Carlos Outro', receiverKey: '99888777666' }),
    makeIntent(),
    false,
    false,
  )
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'receiver_mismatch')
})

test('approve: receiver key matches even if name differs', () => {
  const d = validator.validate(
    makeReceipt({ receiverName: 'Nome Diferente', receiverKey: '11999999999' }),
    makeIntent(),
    false,
    false,
  )
  assert.equal(d.approved, true)
})

test('approve: receiver first name matches even if key format differs', () => {
  const d = validator.validate(
    makeReceipt({ receiverName: 'maria silva santos', receiverKey: null }),
    makeIntent(),
    false,
    false,
  )
  assert.equal(d.approved, true)
})

test('reject: invalid status', () => {
  const d = validator.validate(makeReceipt({ status: 'pendente' }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'invalid_status')
})

test('approve: status ausente (comprovante Nubank não traz status)', () => {
  const d = validator.validate(makeReceipt({ status: null }), makeIntent(), false, false)
  assert.equal(d.approved, true)
})

test('reject: status agendado', () => {
  const d = validator.validate(makeReceipt({ status: 'Transferência agendada' }), makeIntent(), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'invalid_status')
})

test('reject: duplicate transactionId', () => {
  const d = validator.validate(makeReceipt(), makeIntent(), true, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'duplicate_transaction')
})

test('reject: duplicate receipt fingerprint', () => {
  const d = validator.validate(makeReceipt(), makeIntent(), false, true)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'duplicate_transaction')
})

test('reject: intent already paid', () => {
  const d = validator.validate(makeReceipt(), makeIntent({ status: 'paid' }), false, false)
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'intent_not_pending')
})

test('reject: no paidAt, intent from yesterday', () => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const d = validator.validate(
    makeReceipt({ paidAt: null }),
    makeIntent({ createdAt: yesterday }),
    false,
    false,
  )
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'date_out_of_window')
})

test('approve: no paidAt, intent from today', () => {
  const intent = makeIntent({ createdAt: tenMinAgo })
  const d = validator.validate(makeReceipt({ paidAt: null }), intent, false, false)
  assert.equal(d.approved, true)
})

// ── Fingerprint builder ───────────────────────────────────────────────────────

test('fingerprint: same receipt same fingerprint', () => {
  const r = makeReceipt()
  const fp1 = validator.buildFingerprint(r)
  const fp2 = validator.buildFingerprint(r)
  assert.equal(fp1, fp2)
})

test('fingerprint: different amount = different fingerprint', () => {
  const fp1 = validator.buildFingerprint(makeReceipt({ amountCentavos: 1500 }))
  const fp2 = validator.buildFingerprint(makeReceipt({ amountCentavos: 1600 }))
  assert.notEqual(fp1, fp2)
})

// ─── Tolerância configurável (painel do bot): até X a menos / teto do a mais ──

test('tolerância under=100: R$14,90 num pix de R$15 APROVA (90c dentro da margem)', () => {
  const d = validator.validate(makeReceipt({ amountCentavos: 1490 }), makeIntent(), false, false, { underCentavos: 100 })
  assert.equal(d.approved, true)
})

test('tolerância under=100: R$13,50 num pix de R$15 rejeita (150c além da margem)', () => {
  const d = validator.validate(makeReceipt({ amountCentavos: 1350 }), makeIntent(), false, false, { underCentavos: 100 })
  assert.equal(d.approved, false)
  assert.equal(d.reason, 'amount_mismatch')
})

test('teto over=1000: +R$5 aprova; +R$20 cai pra humano', () => {
  const ok = validator.validate(makeReceipt({ amountCentavos: 2000 }), makeIntent(), false, false, { overCentavos: 1000 })
  assert.equal(ok.approved, true)
  const alto = validator.validate(makeReceipt({ amountCentavos: 3500 }), makeIntent(), false, false, { overCentavos: 1000 })
  assert.equal(alto.approved, false)
  assert.equal(alto.reason, 'amount_mismatch')
})

test('sem tolerâncias: comportamento padrão (a mais ilimitado, a menos rejeita)', () => {
  assert.equal(validator.validate(makeReceipt({ amountCentavos: 99900 }), makeIntent(), false, false).approved, true)
  assert.equal(validator.validate(makeReceipt({ amountCentavos: 1499 }), makeIntent(), false, false).approved, false)
})
