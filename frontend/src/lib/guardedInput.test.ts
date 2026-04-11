import { describe, expect, it } from 'vitest'

import {
  applyTextToQueue,
  isBlockedKeyboardEvent,
  sanitizeBarkText,
} from './guardedInput'

describe('isBlockedKeyboardEvent', () => {
  it('blocks functional keys and modified shortcuts', () => {
    expect(isBlockedKeyboardEvent({ key: 'Enter' })).toBe(true)
    expect(isBlockedKeyboardEvent({ key: 'Backspace' })).toBe(true)
    expect(isBlockedKeyboardEvent({ key: 'b', ctrlKey: true })).toBe(true)
    expect(isBlockedKeyboardEvent({ key: 'x', metaKey: true })).toBe(true)
  })

  it('allows plain printable keys across languages', () => {
    expect(isBlockedKeyboardEvent({ key: 'a' })).toBe(false)
    expect(isBlockedKeyboardEvent({ key: '7' })).toBe(false)
    expect(isBlockedKeyboardEvent({ key: '멍' })).toBe(false)
    expect(isBlockedKeyboardEvent({ key: 'Ж' })).toBe(false)
  })
})

describe('sanitizeBarkText', () => {
  it('preserves printable multilingual text while stripping control characters', () => {
    expect(sanitizeBarkText('멍! bark\t123\n\u0000')).toBe('멍! bark123')
  })
})

describe('applyTextToQueue', () => {
  it('emits 20-character jobs and keeps the remainder', () => {
    const result = applyTextToQueue(
      {
        pendingBuffer: 'abc',
        transcript: '',
        queue: [],
      },
      'defghijklmnopqrstuvwxyz123',
    )

    expect(result.pendingBuffer).toBe('wxyz123')
    expect(result.queue).toHaveLength(1)
    expect(result.queue[0].chunk).toBe('abcdefghijklmnopqrst')
    expect(result.transcript).toBe('abcdefghijklmnopqrstuvwxyz123')
  })

  it('creates multiple jobs when enough text arrives at once', () => {
    const result = applyTextToQueue(
      {
        pendingBuffer: '',
        transcript: '',
        queue: [],
      },
      '1234567890123456789012345678901234567890',
    )

    expect(result.pendingBuffer).toBe('')
    expect(result.queue.map((job) => job.chunk)).toEqual([
      '12345678901234567890',
      '12345678901234567890',
    ])
  })
})
