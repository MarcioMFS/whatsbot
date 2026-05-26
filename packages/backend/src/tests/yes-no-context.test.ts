import { describe, it, expect } from 'vitest'

// Test the private helpers by extracting them as standalone functions (same logic)
type BotQuestionType = 'want_more_items' | 'confirm_suggested_title' | 'confirm_checkout' | 'unknown'

function detectBotQuestionType(lastBotMessage: string | null): BotQuestionType {
  if (!lastBotMessage) return 'unknown'
  const m = lastBotMessage.toLowerCase()
  if (/quer mais alguma|mais alguma|quer outra|tem mais alguma|adicionar outra/.test(m)) return 'want_more_items'
  if (/[eé] essa|[eé] esse|[eé] essa que você quer|encontrei.*cat[aá]logo|no nosso cat[aá]logo/.test(m)) return 'confirm_suggested_title'
  if (/gero o pix|pode cobrar|gerar o pix|fechar pedido|valor total|finalizar/.test(m)) return 'confirm_checkout'
  return 'unknown'
}

function isYesMessage(text: string): boolean {
  const t = text.toLowerCase().trim()
  const exactYes = new Set(['sim', 's', 'yeah', 'yes', 'claro', 'pode', 'bora', 'isso', 'exato', 'correto'])
  if (exactYes.has(t)) return true
  return /^(sim|s|claro|pode|bora|isso|exato|correto)[.!,]?\s*$/.test(t) ||
    /^(é isso|é essa|é esse|quero|tá bom|pode ser|aham)[.!,]?\s*$/.test(t)
}

function isNoMessage(text: string): boolean {
  const t = text.toLowerCase().trim()
  const exactNo = new Set(['não', 'nao', 'n', 'nope', 'negativo'])
  if (exactNo.has(t)) return true
  return /^(n[aã]o|n|nope|negativo)[.!,]?\s*$/.test(t) ||
    /^(n[aã]o quero|n[aã]o obrigado|n[aã]o preciso)[.!,]?\s*$/.test(t)
}

// ── detectBotQuestionType ───────────────────────────────────────────────────
describe('detectBotQuestionType', () => {
  it('want_more_items — "Quer mais alguma?"', () => {
    expect(detectBotQuestionType('Quer mais alguma? Ou é só falar *pode cobrar*')).toBe('want_more_items')
  })
  it('want_more_items — "Mais alguma coisa?"', () => {
    expect(detectBotQuestionType('Mais alguma coisa? 😊')).toBe('want_more_items')
  })
  it('confirm_suggested_title — "É essa que você quer?"', () => {
    expect(detectBotQuestionType('Encontrei *Vagabond* no nosso catálogo! É essa que você quer? 😊')).toBe('confirm_suggested_title')
  })
  it('confirm_suggested_title — "É esse mesmo?"', () => {
    expect(detectBotQuestionType('É esse mesmo que você tá buscando?')).toBe('confirm_suggested_title')
  })
  it('confirm_checkout — "pode cobrar"', () => {
    expect(detectBotQuestionType('Tudo pronto! Pode cobrar 😊 Valor: R$6,00')).toBe('confirm_checkout')
  })
  it('confirm_checkout — "gero o pix"', () => {
    expect(detectBotQuestionType('Só falar *pode cobrar* que eu gero o pix!')).toBe('confirm_checkout')
  })
  it('unknown — generic message', () => {
    expect(detectBotQuestionType('Olá! Bem-vindo ao catálogo.')).toBe('unknown')
  })
  it('unknown — null', () => {
    expect(detectBotQuestionType(null)).toBe('unknown')
  })
})

// ── isYesMessage ────────────────────────────────────────────────────────────
describe('isYesMessage', () => {
  const yesPhrases = ['sim', 's', 'yeah', 'yes', 'claro', 'pode', 'bora', 'isso', 'exato', 'correto',
    'é isso', 'é essa', 'é esse', 'quero', 'tá bom', 'pode ser', 'aham']
  for (const phrase of yesPhrases) {
    it(`"${phrase}" is yes`, () => expect(isYesMessage(phrase)).toBe(true))
  }

  // Should NOT be yes
  const notYes = ['não', 'nao', 'talvez', 'quero mais uma', 'me diz outra', 'ok mais', 'é isso aí mas']
  for (const phrase of notYes) {
    it(`"${phrase}" is NOT yes`, () => expect(isYesMessage(phrase)).toBe(false))
  }
})

// ── isNoMessage ─────────────────────────────────────────────────────────────
describe('isNoMessage', () => {
  const noPhrases = ['não', 'nao', 'n', 'nope', 'negativo', 'não quero', 'não obrigado', 'não preciso']
  for (const phrase of noPhrases) {
    it(`"${phrase}" is no`, () => expect(isNoMessage(phrase)).toBe(true))
  }

  // Should NOT be no
  const notNo = ['sim', 's', 'talvez', 'não tenho certeza mas quero sim', 'sim não sei']
  for (const phrase of notNo) {
    it(`"${phrase}" is NOT no`, () => expect(isNoMessage(phrase)).toBe(false))
  }
})

// ── Boundary cases ───────────────────────────────────────────────────────────
describe('edge cases', () => {
  it('"sim" is NOT no', () => expect(isNoMessage('sim')).toBe(false))
  it('"não" is NOT yes', () => expect(isYesMessage('não')).toBe(false))
  it('"talvez" is neither yes nor no', () => {
    expect(isYesMessage('talvez')).toBe(false)
    expect(isNoMessage('talvez')).toBe(false)
  })
  it('"quero mais uma" is not a simple yes (multi-word)', () => {
    expect(isYesMessage('quero mais uma')).toBe(false)
  })
})
