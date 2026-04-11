import test from 'node:test'
import assert from 'node:assert/strict'

import { generateChaosInput, parseArgs } from './generate-chaos-input.mjs'

test('parseArgs uses defaults when flags are absent', () => {
  assert.deepEqual(parseArgs([]), { length: 240, seed: 7 })
})

test('parseArgs reads explicit length and seed', () => {
  assert.deepEqual(parseArgs(['--length', '60', '--seed', '11']), {
    length: 60,
    seed: 11,
  })
})

test('generateChaosInput is deterministic', () => {
  const first = generateChaosInput({ length: 32, seed: 5 })
  const second = generateChaosInput({ length: 32, seed: 5 })

  assert.equal(first, second)
})

test('generateChaosInput respects requested length and allowed character classes', () => {
  const output = generateChaosInput({ length: 180, seed: 9 })

  assert.equal(output.length, 180)
  assert.match(output, /^[\p{Letter}\p{Number}]+$/u)
})
