import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { applyTextToQueue, isBlockedKeyboardEvent } from './guardedInput'

type GuardedInputContract = {
  cases: Array<{
    name: string
    event: {
      key: string
      ctrlKey?: boolean
      metaKey?: boolean
      altKey?: boolean
    }
    accepted: string
  }>
}

type QueueChunkingContract = {
  cases: Array<{
    name: string
    input: string
    expected: {
      emitted: string[]
      remainder: string
    }
  }>
}

const guardedInputContract = JSON.parse(
  readFileSync(
    new URL('../../../verification/contracts/guarded-input.json', import.meta.url),
    'utf8',
  ),
) as GuardedInputContract

const queueChunkingContract = JSON.parse(
  readFileSync(
    new URL('../../../verification/contracts/queue-chunking.json', import.meta.url),
    'utf8',
  ),
) as QueueChunkingContract

describe('guarded input contract', () => {
  it.each(guardedInputContract.cases)('$name', ({ event, accepted }) => {
    expect(isBlockedKeyboardEvent(event)).toBe(accepted === '')
  })
})

describe('queue chunking contract', () => {
  it.each(queueChunkingContract.cases)('$name', ({ input, expected }) => {
    const result = applyTextToQueue(
      {
        pendingBuffer: '',
        transcript: '',
        queue: [],
      },
      input,
    )

    expect(result.queue.map((job) => job.chunk)).toEqual(expected.emitted)
    expect(result.pendingBuffer).toBe(expected.remainder)
    expect(result.transcript).toBe(input)
  })
})
