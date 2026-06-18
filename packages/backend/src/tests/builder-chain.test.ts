import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIGenerationService, BUILDER_CHAIN } from '../services/AIGenerationService.js'
import type { AIProviderPort, AIGenerateResult } from '@whatsbot/core'

// Provider falso: marca se foi chamado e devolve um conteúdo fixo (ou lança).
function fake(name: string, onCall: () => AIGenerateResult): AIProviderPort & { called: boolean } {
  const p = {
    providerName: name,
    called: false,
    async generate(): Promise<AIGenerateResult> { p.called = true; return onCall() },
  }
  return p
}
const ok = (content: string): AIGenerateResult => ({ content, inputTokens: 0, outputTokens: 0 })
const PARAMS = { systemPrompt: '', promptTemplate: '', history: [], userMessage: '', variables: {} }

test('BUILDER_CHAIN nunca inclui provider pago (claude)', () => {
  assert.ok(!BUILDER_CHAIN.includes('claude'), 'claude (pago) não pode estar na cadeia do builder')
  assert.deepEqual(BUILDER_CHAIN, ['nvidia', 'groq'])
})

test('generateBuilder usa nvidia e NUNCA chama claude', async () => {
  const claude = fake('claude', () => ok('PAGO'))
  const groq = fake('groq', () => ok('groq'))
  const nvidia = fake('nvidia', () => ok('nvidia-ok'))
  const svc = new AIGenerationService({ claude, groq, nvidia })
  const r = await svc.generateBuilder(PARAMS)
  assert.equal(r.content, 'nvidia-ok')
  assert.equal(claude.called, false, 'claude pago JAMAIS pode ser chamado pelo builder')
  assert.equal(groq.called, false)
})

test('generateBuilder cai nvidia->groq em erro, ainda sem claude', async () => {
  const claude = fake('claude', () => ok('PAGO'))
  const groq = fake('groq', () => ok('groq-fallback'))
  const nvidia = fake('nvidia', () => { throw new Error('nvidia down') })
  const svc = new AIGenerationService({ claude, groq, nvidia })
  const r = await svc.generateBuilder(PARAMS)
  assert.equal(r.content, 'groq-fallback')
  assert.equal(claude.called, false)
})

test('generateBuilder lança se a cadeia free toda cair — nunca cai pro claude pago', async () => {
  const claude = fake('claude', () => ok('PAGO'))
  const groq = fake('groq', () => { throw new Error('groq down') })
  const nvidia = fake('nvidia', () => { throw new Error('nvidia down') })
  const svc = new AIGenerationService({ claude, groq, nvidia })
  await assert.rejects(() => svc.generateBuilder(PARAMS))
  assert.equal(claude.called, false, 'mesmo com tudo caído, claude pago não é tocado')
})
