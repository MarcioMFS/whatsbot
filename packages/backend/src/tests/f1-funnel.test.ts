import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeConversions } from '../services/MetricsAggregator.js'

test('computeConversions: 1ª etapa = null, demais = razão sobre a anterior', () => {
  assert.deepEqual(computeConversions([204, 77, 31, 31, 7]), [null, 77 / 204, 31 / 77, 31 / 31, 7 / 31])
})

test('computeConversions: divisão por zero vira null (nunca NaN/Infinity)', () => {
  assert.deepEqual(computeConversions([0, 0, 5]), [null, null, null])
})

test('computeConversions: funil não-aninhado pode passar de 1.0 (informativo, não bug)', () => {
  assert.equal(computeConversions([10, 12])[1], 1.2)
})
