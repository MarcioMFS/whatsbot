import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveTerminalOutcome } from '@whatsbot/core'

// F0 — a heurística que decide se uma conversa que CHEGOU AO FIM foi venda (paid) ou só encerrou.
test('deriveTerminalOutcome: passou por post_purchase = paid; senão = completed', () => {
  assert.equal(deriveTerminalOutcome('post_purchase'), 'paid')
  assert.equal(deriveTerminalOutcome('awaiting_payment'), 'completed')
  assert.equal(deriveTerminalOutcome('building_cart'), 'completed')
  assert.equal(deriveTerminalOutcome('pre_sale'), 'completed')
  assert.equal(deriveTerminalOutcome(null), 'completed')
  assert.equal(deriveTerminalOutcome(undefined), 'completed')
})
