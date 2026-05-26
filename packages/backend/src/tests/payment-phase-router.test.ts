import { describe, it, expect, vi } from 'vitest'
import { PaymentPhaseRouter } from '../services/PaymentPhaseRouter.js'
import type { PaymentPhaseContext } from '../services/PaymentPhaseRouter.js'
import type { AIGenerationService } from '../services/AIGenerationService.js'

// Minimal stub — deterministic path never hits AI
const mockAI = {
  generate: vi.fn().mockResolvedValue({ content: '{"intent":"noise","reply":"","confidence":0.5}' }),
} as unknown as AIGenerationService

const router = new PaymentPhaseRouter(mockAI)

const baseCtx: PaymentPhaseContext = {
  userMessage: '',
  lastBotMessage: 'Para confirmar sua compra, me envie o comprovante do Pix.',
  cartItems: [{ productId: 'p1', name: 'Vagabond', priceCentavos: 600, accessLink: 'https://example.com/vagabond' }],
  cartTotalBrl: 'R$ 6,00',
  paymentIntentId: 'pi-123',
  minutesSincePixGenerated: 5,
  hasImage: false,
}

// ── edit_order ──────────────────────────────────────────────────────────────
describe('edit_order — deterministic patterns', () => {
  const editPhrases = [
    'quero trocar',
    'Quero Trocar',
    'errei',
    'quero mudar',
    'tira essa',
    'adiciona mais uma',
    'adicionar mais uma série',
    'quero outra',
    'escolhi errado',
    'colocar mais',
    'mais uma série',
  ]

  for (const phrase of editPhrases) {
    it(`classifies "${phrase}" as edit_order`, async () => {
      const decision = await router.route({ ...baseCtx, userMessage: phrase })
      expect(decision.intent).toBe('edit_order')
      expect(decision.confidence).toBeGreaterThanOrEqual(0.9)
    })
  }
})

// ── cancel_order ────────────────────────────────────────────────────────────
describe('cancel_order — deterministic patterns', () => {
  const cancelPhrases = [
    'desisti',
    'cancela',
    'cancelar',
    'deixa pra lá',
    'deixa para lá',
    'não quero mais',
    'esquece',
    'vou sair',
    'não vou comprar',
    'desistir',
  ]

  for (const phrase of cancelPhrases) {
    it(`classifies "${phrase}" as cancel_order`, async () => {
      const decision = await router.route({ ...baseCtx, userMessage: phrase })
      expect(decision.intent).toBe('cancel_order')
      expect(decision.confidence).toBeGreaterThanOrEqual(0.9)
    })
  }
})

// ── noise — should NOT match edit/cancel ───────────────────────────────────
describe('noise — deterministic path returns null → AI fallback', () => {
  const noisePhrases = ['kkk', 'ok', '?', '😊', 'sim', 'entendi', 'tá']

  for (const phrase of noisePhrases) {
    it(`does NOT misclassify noise "${phrase}"`, async () => {
      // AI stub returns noise
      const decision = await router.route({ ...baseCtx, userMessage: phrase })
      // Should not be edit or cancel from deterministic path
      expect(decision.intent).not.toBe('edit_order')
      expect(decision.intent).not.toBe('cancel_order')
    })
  }
})

// ── No AI calls for deterministic intents ────────────────────────────────────
it('edit_order: no AI call (deterministic)', async () => {
  const spy = vi.spyOn(mockAI, 'generate')
  spy.mockClear()
  await router.route({ ...baseCtx, userMessage: 'quero trocar' })
  expect(spy).not.toHaveBeenCalled()
})

it('cancel_order: no AI call (deterministic)', async () => {
  const spy = vi.spyOn(mockAI, 'generate')
  spy.mockClear()
  await router.route({ ...baseCtx, userMessage: 'desisti' })
  expect(spy).not.toHaveBeenCalled()
})
