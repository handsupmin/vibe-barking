import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readContract(name) {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'verification', 'contracts', name), 'utf8'),
  )
}

test('guarded input contract covers accepted and rejected paths', () => {
  const contract = readContract('guarded-input.json')

  assert.equal(contract.version, 1)
  assert.ok(contract.cases.length >= 6)
  assert.ok(contract.cases.some((entry) => entry.accepted === '멍'))
  assert.ok(contract.cases.some((entry) => entry.accepted === '٤'))
  assert.ok(contract.cases.some((entry) => entry.accepted === ''))
})

test('queue chunking contract keeps emitted chunks at 20 chars', () => {
  const contract = readContract('queue-chunking.json')

  for (const entry of contract.cases) {
    for (const chunk of entry.expected.emitted) {
      assert.equal(chunk.length, 20)
    }
  }
})

test('provider validation contract lists all required providers', () => {
  const contract = readContract('provider-validation.json')
  const names = contract.providers.map((provider) => provider.name)

  assert.deepEqual(names, ['openai', 'gemini', 'claude', 'codex'])

  const codex = contract.providers.find((provider) => provider.name === 'codex')
  assert.equal(codex.clientMayProvideCommand, false)
})

test('preview isolation contract forbids unsafe iframe capabilities', () => {
  const contract = readContract('preview-isolation.json')

  assert.ok(contract.requiredSandboxTokens.includes('allow-scripts'))
  assert.ok(contract.forbiddenSandboxTokens.includes('allow-same-origin'))
  assert.ok(contract.forbiddenSandboxTokens.includes('allow-top-navigation'))
})

