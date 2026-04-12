import assert from 'node:assert/strict'
import test from 'node:test'

import { createGeminiProvider } from '../src/providers/gemini.ts'

test('Gemini provider streams SSE deltas into progress callback and assembles final output', async () => {
  const chunks = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}\n\n',
  ]

  const fetchFn: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.includes(':streamGenerateContent?alt=sse')) {
      throw new Error(`unexpected url: ${url}`)
    }

    let index = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(new TextEncoder().encode(chunks[index]))
        index += 1
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
      },
    })
  }

  const provider = createGeminiProvider({
    env: {
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
    },
    fetchFn,
  })

  const deltas: string[] = []
  const result = await provider.generate({
    prompt: {
      system: 'system',
      user: 'user',
      category: 'playground',
      chunk: 'ABCDEFGHIJKLMNOPQRST',
      sequence: 1,
    },
    onProgressDelta: (delta) => deltas.push(delta),
  })

  assert.deepEqual(deltas, ['Hello ', 'world'])
  assert.equal(result.outputText, 'Hello world')
  assert.equal(result.preview.summary, 'A bark-driven interactive browser demo.')
})
