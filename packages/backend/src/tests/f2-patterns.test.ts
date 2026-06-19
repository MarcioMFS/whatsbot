import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wilsonLowerBound, passesKAnonymity, PLAYBOOK_SEED } from '../services/PatternDistiller.js'

test('wilsonLowerBound: penaliza n pequeno (7/10 não vale 700/1000)', () => {
  const small = wilsonLowerBound(7, 10)
  const big = wilsonLowerBound(700, 1000)
  assert.ok(small < big, 'mesma proporção, n menor = lower bound menor')
  assert.ok(big > small + 0.2, 'a diferença é substancial')
})

test('wilsonLowerBound: bordas sem NaN/Infinity', () => {
  assert.equal(wilsonLowerBound(0, 0), 0)
  assert.equal(wilsonLowerBound(0, 50), 0)
  assert.ok(wilsonLowerBound(50, 50) > 0.9 && wilsonLowerBound(50, 50) <= 1)
})

test('passesKAnonymity: exige n>=20 E bots>=2 (anti-vazamento de 1 tenant)', () => {
  assert.equal(passesKAnonymity(20, 2), true)
  assert.equal(passesKAnonymity(19, 2), false)
  assert.equal(passesKAnonymity(20, 1), false)
  assert.equal(passesKAnonymity(100, 1), false)
})

test('PLAYBOOK_SEED: genérico (sem marca/preço/produto), campos válidos', () => {
  const FIELDS = new Set(['introMessage', 'askMessage', 'offerMessage', 'payPatterns', 'general'])
  for (const p of PLAYBOOK_SEED) {
    assert.ok(FIELDS.has(p.field), `campo válido: ${p.field}`)
    assert.ok(p.guidance.length > 10 && p.bucket && p.sampleTextAnon)
    // sem dígitos de preço (R$, números de valor) na amostra anônima
    assert.ok(!/R\$|\d{2,}[,.]\d{2}/.test(p.sampleTextAnon), `sem preço no sample: ${p.bucket}`)
  }
  assert.ok(PLAYBOOK_SEED.length >= 6)
})
