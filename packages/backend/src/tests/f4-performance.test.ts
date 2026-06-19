import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePatternFate } from '../services/PatternPerformanceService.js'

test('decidePatternFate: sem k-anonymity (n<20 OU bots<2) → keep (não mexe sem evidência)', () => {
  assert.equal(decidePatternFate(0.9, 0.1, 10, 2), 'keep') // n<20
  assert.equal(decidePatternFate(0.9, 0.1, 50, 1), 'keep') // bots<2
})

test('decidePatternFate: lower bound bate o baseline com folga (>=1.1x) → promote', () => {
  assert.equal(decidePatternFate(0.20, 0.10, 50, 2), 'promote')
})

test('decidePatternFate: claramente pior (<0.7x) → retire', () => {
  assert.equal(decidePatternFate(0.05, 0.10, 50, 2), 'retire')
})

test('decidePatternFate: zona neutra → keep', () => {
  assert.equal(decidePatternFate(0.10, 0.10, 50, 2), 'keep')
})

test('decidePatternFate: baseline 0 → keep (sem referência)', () => {
  assert.equal(decidePatternFate(0.5, 0, 50, 2), 'keep')
})
