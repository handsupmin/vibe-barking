import type { BacklogEntry, QueueJob } from './contracts'

interface SelectPreviewEntryInput {
  currentJob: QueueJob | null
  latestSessionResolvedJob: BacklogEntry | null
  latestResolvedJob: BacklogEntry | null
  recentBacklogEntries: BacklogEntry[]
}

export function selectPreviewEntry({
  currentJob,
  latestSessionResolvedJob,
  latestResolvedJob,
  recentBacklogEntries,
}: SelectPreviewEntryInput): BacklogEntry | null {
  if (latestSessionResolvedJob) {
    return latestSessionResolvedJob
  }

  if (latestResolvedJob) {
    return latestResolvedJob
  }

  if (currentJob) {
    return recentBacklogEntries[0] ?? null
  }

  return recentBacklogEntries[0] ?? null
}
