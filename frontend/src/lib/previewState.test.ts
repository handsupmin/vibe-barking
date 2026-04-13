import { describe, expect, it } from 'vitest'

import type { BacklogEntry, PromptCategory, ProviderId, QueueJob } from './contracts'
import { selectPreviewEntry } from './previewState'

function buildJob(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id: 'job-1',
    chunk: 'abcdefghijklmnopqrst',
    createdAt: '2026-04-13T00:00:00.000Z',
    providerId: 'codex',
    category: '캐주얼게임',
    status: 'processing',
    stage: 'working',
    thinking: [],
    stageLog: [],
    ...overrides,
  }
}

function buildEntry(overrides: Partial<BacklogEntry> = {}): BacklogEntry {
  return {
    id: 'entry-1',
    provider: 'codex',
    chunk: 'abcdefghijklmnopqrst',
    category: '캐주얼게임',
    sequence: 1,
    status: 'completed',
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:01.000Z',
    completedAt: '2026-04-13T00:00:01.000Z',
    stage: 'applied',
    stageLog: [],
    preview: {
      title: 'Preview title',
      summary: 'Preview summary',
      html: '<main>Preview body</main>',
      css: 'body { color: red; }',
      javascript: '',
    },
    ...overrides,
  }
}

describe('selectPreviewEntry', () => {
  it('keeps the last resolved preview visible while a new job is processing', () => {
    const latestResolvedJob = buildEntry()

    expect(
      selectPreviewEntry({
        currentJob: buildJob(),
        latestSessionResolvedJob: null,
        latestResolvedJob,
        recentBacklogEntries: [],
      }),
    ).toEqual(latestResolvedJob)
  })

  it('prefers the latest session preview over generic backlog state', () => {
    const latestSessionResolvedJob = buildEntry({ id: 'session-entry', provider: 'claude-code' as ProviderId })
    const latestResolvedJob = buildEntry({ id: 'global-entry' })

    expect(
      selectPreviewEntry({
        currentJob: buildJob({ providerId: 'claude-code', category: '캐주얼게임' as PromptCategory }),
        latestSessionResolvedJob,
        latestResolvedJob,
        recentBacklogEntries: [buildEntry({ id: 'recent-entry' })],
      }),
    ).toEqual(latestSessionResolvedJob)
  })
})
