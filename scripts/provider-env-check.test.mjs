import test from 'node:test'
import assert from 'node:assert/strict'

import {
  evaluateProvider,
  evaluateProviders,
  parseProviders,
  resolveCodexBinary,
} from './provider-env-check.mjs'

test('parseProviders expands all providers by default', () => {
  assert.deepEqual(parseProviders([]), ['openai', 'gemini', 'claude', 'codex'])
})

test('parseProviders accepts comma-delimited values', () => {
  assert.deepEqual(parseProviders(['--provider', 'openai, codex']), [
    'openai',
    'codex',
  ])
})

test('resolveCodexBinary respects explicit overrides', () => {
  assert.equal(resolveCodexBinary({ CODEX_BIN: '/tmp/codex-bin' }), '/tmp/codex-bin')
  assert.equal(
    resolveCodexBinary({ CODEX_CLI_PATH: '/tmp/other-codex' }),
    '/tmp/other-codex',
  )
})

test('api providers report missing env vars', () => {
  const openai = evaluateProvider('openai', {}, { commandExists: () => false })
  assert.equal(openai.status, 'missing')
  assert.match(openai.summary, /OPENAI_API_KEY/)
})

test('gemini accepts either GEMINI_API_KEY or GOOGLE_API_KEY', () => {
  const gemini = evaluateProvider(
    'gemini',
    { GOOGLE_API_KEY: 'set' },
    { commandExists: () => false },
  )

  assert.equal(gemini.status, 'ready')
})

test('codex reports manual when binary exists but env auth is absent', () => {
  const codex = evaluateProvider('codex', {}, { commandExists: () => true })
  assert.equal(codex.status, 'manual')
})

test('codex reports ready when binary and OPENAI_API_KEY are present', () => {
  const codex = evaluateProvider(
    'codex',
    { OPENAI_API_KEY: 'set' },
    { commandExists: () => true },
  )

  assert.equal(codex.status, 'ready')
})

test('evaluateProviders preserves provider order', () => {
  const results = evaluateProviders(
    ['claude', 'codex'],
    { ANTHROPIC_API_KEY: 'set' },
    { commandExists: () => true },
  )

  assert.deepEqual(
    results.map((result) => result.provider),
    ['claude', 'codex'],
  )
})

