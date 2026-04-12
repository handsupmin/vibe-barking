import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CompositionEvent, type FormEvent, type KeyboardEvent } from 'react'

import './index.css'
import {
  CHUNK_SIZE,
  INITIAL_PROVIDER_DRAFTS,
  PROVIDER_DEFINITIONS,
  PROVIDER_MAP,
  type BacklogEntry,
  type BacklogPageResponse,
  type BuilderStage,
  type PromptCategory,
  type ProviderDraft,
  type ProviderId,
  type ProviderMetaSummary,
  type QueueJob,
  SUPPORTED_CATEGORIES,
} from './lib/contracts'
import {
  applyTextToQueue,
  isBlockedKeyboardEvent,
  sanitizeBarkText,
  shouldDeferBeforeInputCapture,
} from './lib/guardedInput'
import { clearBacklog, dispatchQueuedJob, fetchBacklogPage, fetchHelperMeta, validateProvider } from './lib/helperClient'
import { buildPreviewShell } from './lib/preview'
import {
  applyValidatedProviderConnection,
  buildConnectedProviderState,
  deriveWorkspaceBootstrap,
  loadPersistedWorkspaceState,
  mergeProviderDraftsWithConnectedCommands,
  persistWorkspaceState,
} from './lib/providerWorkspace'

type ViewMode = 'loading' | 'setup' | 'workspace'
type SetupFlowMode = 'initial' | 'modal'

interface SessionState {
  pendingBuffer: string
  transcript: string
  jobs: QueueJob[]
}

interface SetupErrorState {
  providerId: ProviderId
  message: string
}

const INITIAL_SESSION: SessionState = {
  pendingBuffer: '',
  transcript: '',
  jobs: [],
}

const TERMINAL_STATUSES = new Set<QueueJob['status']>(['completed', 'failed'])
const ACTIVE_STATUSES = new Set<QueueJob['status']>(['queued', 'dispatching', 'processing', 'waiting-for-helper'])

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: QueueJob['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'dispatching':
      return 'Dispatching'
    case 'processing':
      return 'Processing'
    case 'waiting-for-helper':
      return 'Waiting for helper'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
  }
}

function stageLabel(stage: BuilderStage): string {
  switch (stage) {
    case 'ciphertext_interpreting':
      return '암호문 해석 중'
    case 'working':
      return '작업 중'
    case 'applying':
      return '적용 중'
    case 'applied':
      return '적용 완료'
  }
}

function deriveLivePhase(helperOnline: boolean, currentJob: QueueJob | null, latestResolvedJob: BacklogEntry | null): string {
  if (!helperOnline) {
    return '헬퍼 오프라인'
  }

  if (currentJob) {
    if (currentJob.status === 'dispatching') {
      return '요청 중...'
    }

    if (currentJob.status === 'queued') {
      return currentJob.remoteJobId ? '응답 기다리는중...' : '다음 작업 요청 중...'
    }

    if (currentJob.status === 'waiting-for-helper') {
      return '응답 기다리는중...'
    }

    if (currentJob.status === 'failed') {
      return '작업 실패'
    }

    return stageLabel(currentJob.stage)
  }

  if (latestResolvedJob) {
    return latestResolvedJob.status === 'completed' ? '적용 완료' : '작업 실패'
  }

  return '대기 중'
}

function buildHtmlFromPreview(preview: { title: string; html: string; css: string; javascript: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(
    preview.title,
  )}</title><style>${preview.css}</style></head><body>${preview.html}<script>${preview.javascript}</script></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function humanizeCategory(category: PromptCategory): string {
  return category
    .split('-')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

interface ParsedProgressEnvelope {
  stage?: string
  thinking?: string[]
  result?: {
    mode?: string
    operations?: Array<{
      type?: string
      path?: string
      content?: string
    }>
  }
}

function tryParseProgressEnvelope(value: string): ParsedProgressEnvelope | null {
  const trimmed = value.trim()
  const normalized = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
    : trimmed
  if (!normalized.startsWith('{')) {
    return null
  }

  try {
    return JSON.parse(normalized) as ParsedProgressEnvelope
  } catch {
    return extractPartialProgressEnvelope(normalized)
  }
}

function extractPartialProgressEnvelope(value: string): ParsedProgressEnvelope | null {
  const stage = value.match(/"stage"\s*:\s*"([^"]+)"/)?.[1]
  const thinkingMatches = [...value.matchAll(/"thinking"\s*:\s*\[(.*?)\]/gs)]
  const thinkingSource = thinkingMatches.at(-1)?.[1] ?? ''
  const thinking = [...thinkingSource.matchAll(/"((?:\\.|[^"])*)"/g)].map((match) =>
    match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
  )
  const operationMatches = [
    ...value.matchAll(/\{"type":"([^"]+)","path":"([^"]+)"(?:,"content":"((?:\\.|[^"])*)")?/g),
  ]
  const operations = operationMatches.map((match) => ({
    type: match[1],
    path: match[2],
    content: match[3]?.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
  }))

  if (!stage && thinking.length === 0 && operations.length === 0) {
    return null
  }

  return {
    stage,
    thinking,
    result: operations.length > 0 ? { operations } : undefined,
  }
}


function isGenericPreviewLabel(value: string | undefined): boolean {
  if (!value) {
    return true
  }

  return ['preview', 'summary', 'demo', 'app'].includes(value.trim().toLowerCase())
}

function summarizeOperationContent(content?: string): string {
  if (!content) {
    return ''
  }

  const cleaned = content.replace(/\s+/g, ' ').trim()
  return cleaned.length > 96 ? `${cleaned.slice(0, 96)}…` : cleaned
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('loading')
  const [helperOnline, setHelperOnline] = useState(true)
  const [providerDrafts, setProviderDrafts] = useState<Record<ProviderId, ProviderDraft>>(INITIAL_PROVIDER_DRAFTS)
  const [providerSummaries, setProviderSummaries] = useState<Record<ProviderId, ProviderMetaSummary | null>>(() =>
    Object.fromEntries(PROVIDER_DEFINITIONS.map((provider) => [provider.id, null])) as Record<ProviderId, ProviderMetaSummary | null>,
  )
  const [connectedProviderIds, setConnectedProviderIds] = useState<ProviderId[]>([])
  const [activeProviderId, setActiveProviderId] = useState<ProviderId | null>(null)
  const [setupProviderId, setSetupProviderId] = useState<ProviderId | null>(null)
  const [setupError, setSetupError] = useState<SetupErrorState | null>(null)
  const [setupFlowMode, setSetupFlowMode] = useState<SetupFlowMode>('initial')
  const [isValidating, setIsValidating] = useState(false)
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false)
  const [isBacklogOpen, setIsBacklogOpen] = useState(false)
  const [isQueueExpanded, setIsQueueExpanded] = useState(false)
  const [backlogPageNumber, setBacklogPageNumber] = useState(1)
  const [backlogPage, setBacklogPage] = useState<BacklogPageResponse | null>(null)
  const [recentBacklogEntries, setRecentBacklogEntries] = useState<BacklogEntry[]>([])
  const [session, setSession] = useState<SessionState>(INITIAL_SESSION)
  const [helperMessage, setHelperMessage] = useState(
    'Pick one interpreter, validate it, and then start barking into the pipeline.',
  )
  const [selectedCategory, setSelectedCategory] = useState<PromptCategory>('캐주얼게임')
  const [lastBlockedKey, setLastBlockedKey] = useState<string | null>(null)
  const [isComposingBark, setIsComposingBark] = useState(false)
  const [compositionText, setCompositionText] = useState('')
  const [latestResolvedJob, setLatestResolvedJob] = useState<BacklogEntry | null>(null)
  const [latestSessionResolvedJob, setLatestSessionResolvedJob] = useState<BacklogEntry | null>(null)
  const [latestSessionRunContext, setLatestSessionRunContext] = useState<{ providerId: ProviderId; category: PromptCategory } | null>(null)
  const [latestResolvedOutputText, setLatestResolvedOutputText] = useState('')
  const [latestSessionResolvedOutputText, setLatestSessionResolvedOutputText] = useState('')
  const [displayedProgressText, setDisplayedProgressText] = useState('')
  const [lastEphemeralStreamText, setLastEphemeralStreamText] = useState('')
  const [dispatchingJobIds, setDispatchingJobIds] = useState<string[]>([])
  const isMountedRef = useRef(true)
  const startedDispatchJobIdsRef = useRef<Set<string>>(new Set())

  const activeWorkspaceProviderId = activeProviderId ?? connectedProviderIds[0] ?? null
  const activeProvider = activeWorkspaceProviderId ? PROVIDER_MAP[activeWorkspaceProviderId] : null
  const activeDraft = activeWorkspaceProviderId ? providerDrafts[activeWorkspaceProviderId] : null
  const selectedSetupProvider = setupProviderId ? PROVIDER_MAP[setupProviderId] : null
  const selectedSetupDraft = setupProviderId ? providerDrafts[setupProviderId] : null

  const barkPadValue = session.transcript + compositionText

  const currentJob = useMemo(
    () =>
      [...session.jobs]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .find((job) => !TERMINAL_STATUSES.has(job.status)) ?? null,
    [session.jobs],
  )
  const hasHelperDispatchInFlight = useMemo(
    () =>
      session.jobs.some(
        (job) =>
          dispatchingJobIds.includes(job.id) ||
          (ACTIVE_STATUSES.has(job.status) &&
            (job.status !== 'queued' || Boolean(job.helperMessage) || Boolean(job.remoteJobId))),
      ),
    [dispatchingJobIds, session.jobs],
  )
  const queuedLocalJob = useMemo(
    () => {
      if (hasHelperDispatchInFlight) {
        return undefined
      }

      return (
      session.jobs.find(
        (job) => job.status === 'queued' && !job.helperMessage && !dispatchingJobIds.includes(job.id),
      ))
    },
    [dispatchingJobIds, hasHelperDispatchInFlight, session.jobs],
  )
  const activeRemoteJobSignature = useMemo(
    () =>
      session.jobs
        .filter((job) => job.remoteJobId && ACTIVE_STATUSES.has(job.status))
        .map((job) => `${job.id}:${job.remoteJobId}:${job.status}:${job.stage}:${job.thinking.join('|')}`)
        .join('|'),
    [session.jobs],
  )
  const queueDepth = session.jobs.length
  const previewEntry = currentJob
    ? latestSessionResolvedJob ?? null
    : latestSessionResolvedJob ?? latestResolvedJob ?? recentBacklogEntries[0] ?? null
  const fallbackResolvedJob = latestSessionResolvedJob ?? latestResolvedJob
  const livePhase = deriveLivePhase(helperOnline, currentJob, latestSessionResolvedJob ?? latestResolvedJob)
  const hasMeaningfulPreview =
    Boolean(previewEntry?.preview) &&
    !isGenericPreviewLabel(previewEntry?.preview?.title) &&
    !isGenericPreviewLabel(previewEntry?.preview?.summary)
  const previewDocument = useMemo(
    () =>
      hasMeaningfulPreview && previewEntry?.preview
        ? buildHtmlFromPreview(previewEntry.preview)
        : buildPreviewShell({
            providerLabel: activeProvider?.label ?? 'No provider yet',
            queueDepth,
            pendingCharacters: session.pendingBuffer.length,
            latestChunk: currentJob ? undefined : previewEntry?.chunk,
            helperMessage: currentJob
              ? `${PROVIDER_MAP[currentJob.providerId].label} · ${livePhase}`
              : helperMessage,
            title: currentJob ? `${humanizeCategory(currentJob.category)} preview in progress` : undefined,
            summary: currentJob
              ? `${PROVIDER_MAP[currentJob.providerId].label} is shaping the next diff for this ${currentJob.category} artifact.`
              : undefined,
            statusLabel: livePhase,
          }),
    [activeProvider?.label, currentJob, hasMeaningfulPreview, helperMessage, livePhase, previewEntry, queueDepth, session.pendingBuffer.length],
  )
  const displayPreviewTitle = !isGenericPreviewLabel(previewEntry?.preview?.title)
    ? previewEntry?.preview?.title
    : currentJob
      ? `${humanizeCategory(currentJob.category)} preview in progress`
      : latestSessionRunContext
        ? `${humanizeCategory(latestSessionRunContext.category)} result ready`
        : fallbackResolvedJob
          ? `${humanizeCategory(fallbackResolvedJob.category)} result ready`
        : 'Live preview is standing by'
  const displayPreviewSummary = !isGenericPreviewLabel(previewEntry?.preview?.summary)
    ? previewEntry?.preview?.summary
    : currentJob
      ? `${PROVIDER_MAP[currentJob.providerId].label} is shaping the next diff for this ${currentJob.category} artifact.`
      : latestSessionRunContext
        ? `${PROVIDER_MAP[latestSessionRunContext.providerId].label} just completed the latest ${latestSessionRunContext.category} artifact.`
        : fallbackResolvedJob
          ? `${PROVIDER_MAP[fallbackResolvedJob.provider].label} just completed the latest ${fallbackResolvedJob.category} artifact.`
        : 'The next applied diff will appear here immediately.'
  const streamProviderLabel = currentJob
    ? PROVIDER_MAP[currentJob.providerId].label
    : latestSessionResolvedJob
      ? PROVIDER_MAP[latestSessionResolvedJob.provider].label
      : activeProvider?.label ?? (previewEntry ? PROVIDER_MAP[previewEntry.provider].label : 'No provider')
  const progressStreamSource = useMemo(() => {
    if (currentJob?.streamText?.trim()) {
      return currentJob.streamText
    }

    if (lastEphemeralStreamText.trim()) {
      return lastEphemeralStreamText
    }

    if (latestSessionResolvedOutputText.trim()) {
      return latestSessionResolvedOutputText
    }

    if (latestSessionResolvedJob?.outputText?.trim()) {
      return latestSessionResolvedJob.outputText
    }

    if (latestResolvedJob?.outputText?.trim()) {
      return latestResolvedJob.outputText
    }

    if (latestResolvedOutputText.trim()) {
      return latestResolvedOutputText
    }

    if (currentJob?.thinking.length) {
      return currentJob.thinking.join('\n\n')
    }

    if (currentJob?.stageLog.length) {
      return currentJob.stageLog.map((entry) => `${stageLabel(entry.stage)} · ${entry.message}`).join('\n\n')
    }

    if (latestSessionResolvedJob?.stageLog.length) {
      return latestSessionResolvedJob.stageLog.map((entry) => `${stageLabel(entry.stage)} · ${entry.message}`).join('\n\n')
    }

    if (previewEntry?.stageLog.length) {
      return previewEntry.stageLog.map((entry) => `${stageLabel(entry.stage)} · ${entry.message}`).join('\n\n')
    }

    return helperMessage
  }, [currentJob, helperMessage, lastEphemeralStreamText, latestResolvedJob, latestResolvedOutputText, latestSessionResolvedJob, latestSessionResolvedOutputText, previewEntry])
  const parsedProgressEnvelope = useMemo(() => tryParseProgressEnvelope(displayedProgressText), [displayedProgressText])


  function applyHelperMeta(meta: NonNullable<Awaited<ReturnType<typeof fetchHelperMeta>>>) {
    setHelperOnline(true)

    const summaryMap = Object.fromEntries(
      PROVIDER_DEFINITIONS.map((provider) => [
        provider.id,
        meta.providers.find((summary) => summary.provider === provider.id) ?? null,
      ]),
    ) as Record<ProviderId, ProviderMetaSummary | null>

    setProviderSummaries(summaryMap)
    setProviderDrafts((current) => mergeProviderDraftsWithConnectedCommands(current, meta.providers))

    const bootstrapState = deriveWorkspaceBootstrap(meta.providers, loadPersistedWorkspaceState())
    setConnectedProviderIds(bootstrapState.connectedProviderIds)
    setActiveProviderId(bootstrapState.activeProviderId)
    setSetupProviderId((current) => current ?? bootstrapState.setupProviderId)
    setViewMode((current) =>
      current === 'workspace' || bootstrapState.shouldEnterWorkspace ? 'workspace' : 'setup',
    )
    setHelperMessage((current) =>
      bootstrapState.shouldEnterWorkspace && bootstrapState.activeProviderId
        ? `${PROVIDER_MAP[bootstrapState.activeProviderId].label} is ready. Bark now and watch the diff loop evolve the live demo.`
        : current,
    )
  }

  useEffect(() => {
    isMountedRef.current = true
    let cancelled = false

    async function bootstrap() {
      const [meta, backlog] = await Promise.all([fetchHelperMeta(), fetchBacklogPage(1, 5)])
      if (cancelled) {
        return
      }

      setHelperOnline(Boolean(meta))
      setRecentBacklogEntries(backlog?.entries ?? [])
      setLatestResolvedJob(backlog?.entries[0] ?? null)

      if (!meta) {
        setHelperMessage('Local helper unavailable. Start the helper to validate a provider and enter the workspace.')
        setViewMode('setup')
        return
      }

      const bootstrapState = deriveWorkspaceBootstrap(meta.providers, loadPersistedWorkspaceState())
      applyHelperMeta(meta)
      if (!bootstrapState.shouldEnterWorkspace) {
        setHelperMessage('Pick one interpreter and validate it before entering the workspace.')
      }
    }

    void bootstrap()

    return () => {
      isMountedRef.current = false
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (helperOnline) {
      return
    }

    let cancelled = false

    const intervalId = window.setInterval(() => {
      void fetchHelperMeta().then((meta) => {
        if (cancelled || !meta) {
          return
        }

        applyHelperMeta(meta)
      })
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [helperOnline])

  useEffect(() => {
    if (!progressStreamSource) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setDisplayedProgressText(progressStreamSource)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [progressStreamSource])


  useEffect(() => {
    if (!queuedLocalJob) {
      return
    }
    if (startedDispatchJobIdsRef.current.has(queuedLocalJob.id)) {
      return
    }

    startedDispatchJobIdsRef.current.add(queuedLocalJob.id)
    window.setTimeout(() => {
      if (!isMountedRef.current) {
        return
      }

      setDispatchingJobIds((current) =>
        current.includes(queuedLocalJob.id) ? current : [...current, queuedLocalJob.id],
      )
      setSession((current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
          job.id === queuedLocalJob.id
            ? {
                ...job,
                status: 'dispatching',
                remoteJobId: job.remoteJobId ?? job.id,
                helperMessage: `Sending bark chunk to ${PROVIDER_MAP[job.providerId].label}…`,
              }
            : job,
        ),
      }))
    }, 0)

    void dispatchQueuedJob({
      providerId: queuedLocalJob.providerId,
      jobId: queuedLocalJob.id,
      chunk: queuedLocalJob.chunk,
      category: queuedLocalJob.category,
      model: queuedLocalJob.model,
    })
      .then((response) => {
        if (!isMountedRef.current) {
          return
        }

        startedDispatchJobIdsRef.current.delete(queuedLocalJob.id)
        setDispatchingJobIds((current) => current.filter((jobId) => jobId !== queuedLocalJob.id))
        setLastEphemeralStreamText('')
        setLatestSessionResolvedJob(null)
        setLatestSessionResolvedOutputText('')
        setLatestSessionRunContext({ providerId: queuedLocalJob.providerId, category: queuedLocalJob.category })
        setHelperMessage(response.message)
        setSession((current) => ({
          ...current,
          jobs: current.jobs.map((job) =>
            job.id === queuedLocalJob.id
              ? {
                  ...job,
                  status: response.status,
                  remoteJobId: response.remoteJobId ?? job.remoteJobId ?? job.id,
                  helperMessage: response.message,
                }
              : job,
          ),
        }))
      })
      .catch((error) => {
        startedDispatchJobIdsRef.current.delete(queuedLocalJob.id)
        if (!isMountedRef.current) {
          return
        }

        setDispatchingJobIds((current) => current.filter((jobId) => jobId !== queuedLocalJob.id))
        setHelperMessage(error instanceof Error ? error.message : '요청 처리 중 오류가 발생했어.')
        setSession((current) => ({
          ...current,
          jobs: current.jobs.map((job) =>
            job.id === queuedLocalJob.id
              ? {
                  ...job,
                  status: 'failed',
                  error: error instanceof Error ? error.message : 'Dispatch failed.',
                  helperMessage: error instanceof Error ? error.message : 'Dispatch failed.',
                }
            : job,
          ),
        }))
      })
  }, [queuedLocalJob])

  useEffect(() => {
    if (!activeRemoteJobSignature) {
      return
    }

    let cancelled = false

    async function refreshBacklogViews(page = backlogPageNumber) {
      const [recent, paged] = await Promise.all([fetchBacklogPage(1, 5), fetchBacklogPage(page, 10)])
      if (cancelled) {
        return
      }

      if (recent) {
        setRecentBacklogEntries(recent.entries)
      }

      if (isBacklogOpen && paged) {
        setBacklogPage(paged)
      }
    }

    async function pollJobs() {
      const activeJobs = session.jobs.filter((job) => job.remoteJobId && ACTIVE_STATUSES.has(job.status))
      const pollResults = await Promise.all(
        activeJobs.map(async (job) => {
          const response = await fetch(`/api/jobs/${job.remoteJobId}`)
          if (!response.ok) {
            return null
          }

          return {
            localJobId: job.id,
            payload: (await response.json()) as {
              job?: {
                id: string
                status: QueueJob['status']
                stage: BuilderStage
                thinking: string[]
                stageLog: QueueJob['stageLog']
                resultMode?: QueueJob['resultMode']
                streamText?: string
                outputText?: string
                error?: string
                createdAt: string
                updatedAt: string
                chunk: string
                model?: string
                category: PromptCategory
                sequence: number
                preview?: QueueJob['preview']
              }
            },
          }
        }),
      )

      if (cancelled) {
        return
      }

      const helperJobs = new Map(
        pollResults
          .filter((result): result is NonNullable<typeof result> => Boolean(result?.payload.job))
          .map((result) => [result.localJobId, result.payload.job!]),
      )

      const terminalEntries: BacklogEntry[] = []
      const terminalStreams: string[] = []

      setSession((current) => ({
        ...current,
        jobs: current.jobs.flatMap((job) => {
          const helperJob = helperJobs.get(job.id)
          if (!helperJob) {
            return [job]
          }

          const nextJob: QueueJob = {
            ...job,
            status: helperJob.status,
            stage: helperJob.stage,
            thinking: helperJob.thinking,
            stageLog: helperJob.stageLog,
            resultMode: helperJob.resultMode,
            streamText: helperJob.streamText ?? job.streamText,
            helperMessage:
              helperJob.status === 'processing'
                ? `${PROVIDER_MAP[job.providerId].label} ${stageLabel(helperJob.stage)}...`
                : helperJob.error ?? `${PROVIDER_MAP[job.providerId].label} 작업 완료`,
            resultSummary: helperJob.preview?.summary ?? job.resultSummary,
            preview: helperJob.preview ?? job.preview,
            previewHtml: helperJob.preview ? buildHtmlFromPreview(helperJob.preview) : job.previewHtml,
            error: helperJob.error ?? job.error,
          }

          if (TERMINAL_STATUSES.has(nextJob.status)) {
            terminalEntries.push({
              id: helperJob.id,
              provider: job.providerId,
              chunk: helperJob.chunk,
              category: helperJob.category,
              model: helperJob.model,
              sequence: helperJob.sequence,
              status: nextJob.status === 'failed' ? 'failed' : 'completed',
              createdAt: helperJob.createdAt,
              updatedAt: helperJob.updatedAt,
              completedAt: helperJob.updatedAt,
              stage: helperJob.stage,
              stageLog: helperJob.stageLog,
              resultMode: helperJob.resultMode,
              outputText: helperJob.outputText,
              preview: helperJob.preview,
              error: helperJob.error,
            })
            if (helperJob.outputText || helperJob.streamText) {
              terminalStreams.push(helperJob.outputText ?? helperJob.streamText ?? '')
            }
            return []
          }

          return [nextJob]
        }),
      }))

      if (terminalEntries.length > 0) {
        const latest = [...terminalEntries].sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0]
        setLatestResolvedJob(latest)
        setLatestSessionResolvedJob(latest)
        if (terminalStreams.length > 0) {
          const latestStream = terminalStreams.at(-1) ?? ''
          setLastEphemeralStreamText(latestStream)
          setLatestResolvedOutputText(latestStream)
          setLatestSessionResolvedOutputText(latestStream)
        }
        setHelperMessage(latest.status === 'completed' ? `${PROVIDER_MAP[latest.provider].label} 적용 완료` : latest.error ?? '작업 실패')
        await refreshBacklogViews()
      }
    }

    void pollJobs()
    const intervalId = window.setInterval(() => {
      void pollJobs()
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeRemoteJobSignature, backlogPageNumber, isBacklogOpen, session.jobs])

  useEffect(() => {
    if (!isBacklogOpen) {
      return
    }

    let cancelled = false

    async function loadPage() {
      const page = await fetchBacklogPage(backlogPageNumber, 10)
      if (cancelled || !page) {
        return
      }
      setBacklogPage(page)
    }

    void loadPage()

    return () => {
      cancelled = true
    }
  }, [backlogPageNumber, isBacklogOpen])

  function updateProviderDraft(providerId: ProviderId, field: keyof ProviderDraft, value: string) {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        [field]: value,
      },
    }))
  }

  function appendBarkText(rawText: string) {
    if (!activeWorkspaceProviderId || !activeDraft) {
      return
    }

    const sanitized = sanitizeBarkText(rawText)
    if (!sanitized) {
      return
    }

    setSession((current) => {
      const next = applyTextToQueue(
        {
          pendingBuffer: current.pendingBuffer,
          transcript: current.transcript,
          queue: current.jobs,
        },
        sanitized,
      )

      const appendedJobs = next.queue.slice(current.jobs.length).map((job) => ({
        ...job,
        providerId: activeWorkspaceProviderId,
        category: selectedCategory,
        model: activeDraft.model,
        stage: 'ciphertext_interpreting' as BuilderStage,
        thinking: [],
        stageLog: [],
        streamText: '',
      })) as QueueJob[]

      return {
        pendingBuffer: next.pendingBuffer,
        transcript: next.pendingBuffer,
        jobs: [...current.jobs, ...appendedJobs],
      }
    })

    setLastBlockedKey(null)
    setHelperMessage(`${PROVIDER_MAP[activeWorkspaceProviderId].label} 다음 작업 요청 중...`)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isBlockedKeyboardEvent(event)) {
      event.preventDefault()
      setLastBlockedKey(event.key)
    }
  }

  function handleBeforeInput(event: FormEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as InputEvent
    if (shouldDeferBeforeInputCapture(nativeEvent)) {
      return
    }

    if (!nativeEvent.data) {
      return
    }

    event.preventDefault()
    appendBarkText(nativeEvent.data)
  }

  function handleCompositionStart() {
    setIsComposingBark(true)
    setCompositionText('')
  }

  function handleCompositionUpdate(event: CompositionEvent<HTMLTextAreaElement>) {
    setCompositionText(sanitizeBarkText(event.data))
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
    const committed = sanitizeBarkText(event.data || compositionText)
    setIsComposingBark(false)
    setCompositionText('')
    if (committed) {
      appendBarkText(committed)
    }
  }

  function handleBarkPadChange(event: FormEvent<HTMLTextAreaElement>) {
    if (!isComposingBark) {
      return
    }

    const nextValue = event.currentTarget.value
    const nextComposition = nextValue.slice(session.transcript.length)
    setCompositionText(sanitizeBarkText(nextComposition))
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault()
    appendBarkText(event.clipboardData.getData('text'))
  }

  async function refreshHelperSummaries() {
    const meta = await fetchHelperMeta()
    setHelperOnline(Boolean(meta))
    if (!meta) {
      return null
    }

    const summaryMap = Object.fromEntries(
      PROVIDER_DEFINITIONS.map((provider) => [
        provider.id,
        meta.providers.find((summary) => summary.provider === provider.id) ?? null,
      ]),
    ) as Record<ProviderId, ProviderMetaSummary | null>
    setProviderSummaries(summaryMap)
    setProviderDrafts((current) => mergeProviderDraftsWithConnectedCommands(current, meta.providers))
    return meta.providers
  }

  async function handleValidateSelectedProvider(flowMode: SetupFlowMode) {
    if (!setupProviderId || !selectedSetupProvider || !selectedSetupDraft) {
      return
    }

    setIsValidating(true)
    setSetupError(null)

    const result = await validateProvider({
      providerId: setupProviderId,
      secret: selectedSetupProvider.transport === 'cli' ? undefined : selectedSetupDraft.secret,
      model: selectedSetupDraft.model,
      command: selectedSetupProvider.transport === 'cli' ? selectedSetupDraft.command : undefined,
    })

    setIsValidating(false)
    setHelperMessage(result.message)

    if (!result.ok) {
      setSetupError({ providerId: setupProviderId, message: result.message })
      setSetupProviderId(null)
      return
    }

    const summaries = await refreshHelperSummaries()
    const configuredConnected = summaries
      ? connectedProviderIds.filter((providerId) =>
          summaries.some((summary) => summary.provider === providerId && summary.configured),
        )
      : connectedProviderIds
    const connectionState = applyValidatedProviderConnection({
      connectedProviderIds: configuredConnected,
      activeProviderId,
      validatedProviderId: setupProviderId,
      makeActive: flowMode !== 'modal',
    })

    setConnectedProviderIds(connectionState.connectedProviderIds)
    setActiveProviderId(connectionState.activeProviderId)
    persistWorkspaceState(
      buildConnectedProviderState(
        connectionState.connectedProviderIds,
        connectionState.activeProviderId ?? setupProviderId,
        connectionState.lastSuccessfulProviderId,
      ),
    )
    setSetupProviderId(setupProviderId)

    if (flowMode === 'modal') {
      setIsAddProviderOpen(false)
      setSetupFlowMode('initial')
      setHelperMessage(`${PROVIDER_MAP[setupProviderId].label} 연결 완료. 현재 provider는 그대로 유지됩니다.`)
    } else {
      setViewMode('workspace')
      setHelperMessage(`${PROVIDER_MAP[setupProviderId].label} 준비 완료. 이제 bark → diff → apply 루프가 시작됩니다.`)
    }
  }

  function resetSetupSelection() {
    setSetupProviderId(null)
    setSetupError(null)
  }

  function openAddProviderModal() {
    setSetupFlowMode('modal')
    setIsAddProviderOpen(true)
    resetSetupSelection()
  }

  function closeAddProviderModal() {
    setIsAddProviderOpen(false)
    setSetupFlowMode('initial')
    setSetupError(null)
  }

  async function handleResetBacklog() {
    const confirmed = window.confirm('Backlog 전체 기록을 삭제할까? 이 작업은 되돌릴 수 없어.')
    if (!confirmed) {
      return
    }

    const cleared = await clearBacklog()
    if (!cleared) {
      setHelperMessage('Backlog 초기화 실패. helper 상태를 확인해줘.')
      return
    }

    setRecentBacklogEntries([])
    setBacklogPage({
      entries: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
    })
    setBacklogPageNumber(1)
    setLatestResolvedJob(null)
    setLatestSessionResolvedJob(null)
    setLatestSessionRunContext(null)
    setLatestResolvedOutputText('')
    setLatestSessionResolvedOutputText('')
    setDisplayedProgressText('')
    setLastEphemeralStreamText('')
    setHelperMessage('Backlog 전체 기록을 초기화했어.')
  }

  function handleSwitchProvider(providerId: ProviderId) {
    setActiveProviderId(providerId)
    persistWorkspaceState(buildConnectedProviderState(connectedProviderIds, providerId))
    setHelperMessage(`${PROVIDER_MAP[providerId].label}로 전환됨. 다음 bark chunk부터 이 provider를 사용합니다.`)
  }

  const queueSummaryText = currentJob
    ? `${PROVIDER_MAP[currentJob.providerId].label} · ${stageLabel(currentJob.stage)}`
    : '지금은 비어 있음'

  const setupSurface = (
    <SetupSurface
      helperOnline={helperOnline}
      setupError={setupError}
      selectedProviderId={setupProviderId}
      providerDrafts={providerDrafts}
      providerSummaries={providerSummaries}
      connectedProviderIds={connectedProviderIds}
      onSelectProvider={(providerId) => {
        setSetupProviderId(providerId)
        setSetupError(null)
      }}
      onDraftChange={updateProviderDraft}
      onValidate={() => void handleValidateSelectedProvider(setupFlowMode)}
      isValidating={isValidating}
      onResetSelection={resetSetupSelection}
      isModal={setupFlowMode === 'modal'}
      selectedCategory={selectedCategory}
      onSelectCategory={setSelectedCategory}
    />
  )

  return (
    <div className="app-shell">
      {viewMode === 'loading' ? (
        <section className="setup-shell surface-card loading-shell">
          <p className="eyebrow">booting</p>
          <h1>vibe-barking</h1>
          <p className="hero-copy">Checking the local helper and restoring your last successful bark interpreter…</p>
        </section>
      ) : null}

      {viewMode === 'setup' ? setupSurface : null}

      {viewMode === 'workspace' && activeProvider ? (
        <>
          <main className="builder-shell">
            <aside className="builder-rail">
              <section className="builder-rail-top">
                <div>
                  <p className="eyebrow">bark → diff → apply</p>
                  <h1>vibe-barking</h1>
                  <p className="builder-rail-copy">
                    Make the dog bark, enqueue the chunk, watch the worker think, and let the live demo evolve from tiny diffs.
                  </p>
                </div>
                <div className="builder-rail-controls">
                  <div className="provider-switcher provider-switcher-rail" role="tablist" aria-label="Connected bark interpreters">
                    {connectedProviderIds.map((providerId) => {
                      const provider = PROVIDER_MAP[providerId]
                      const active = providerId === activeProviderId
                      return (
                        <button
                          key={providerId}
                          type="button"
                          className={`provider-chip ${active ? 'provider-chip-active' : ''}`}
                          onClick={() => handleSwitchProvider(providerId)}
                        >
                          {provider.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="builder-rail-action-row">
                    <button type="button" className="rail-button" onClick={() => setIsBacklogOpen(true)}>
                      Backlog
                    </button>
                    <button type="button" className="rail-button" onClick={openAddProviderModal}>
                      + Add provider
                    </button>
                  </div>
                </div>
              </section>

              <section className="builder-log-shell">
                <div className="builder-log-heading">
                  <div>
                    <p className="eyebrow">Thinking stream</p>
                    <h2>{livePhase}</h2>
                  </div>
                  <div className="panel-pill-group">
                    <span className="panel-pill">{streamProviderLabel}</span>
                    {currentJob?.resultMode ? <span className="panel-pill panel-pill-neutral">{currentJob.resultMode}</span> : null}
                  </div>
                </div>
                <div className="progress-stage-row">
                  <span className="status-badge status-processing">{currentJob ? stageLabel(currentJob.stage) : '대기 중'}</span>
                  <span className="progress-meta">{currentJob ? `${formatTime(currentJob.createdAt)} · ${currentJob.chunk}` : helperMessage}</span>
                </div>
                <div className="progress-stream-text progress-stream-text-rail">
                  {parsedProgressEnvelope ? (
                    <div className="progress-json-view">
                      <div className="progress-json-header-row">
                        <span className="panel-pill panel-pill-neutral">{parsedProgressEnvelope.stage ?? 'working'}</span>
                        <span className="progress-json-caption">structured payload</span>
                      </div>
                      {parsedProgressEnvelope.thinking?.length ? (
                        <ul className="progress-thinking-list">
                          {parsedProgressEnvelope.thinking.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                      {parsedProgressEnvelope.result?.operations?.length ? (
                        <div className="progress-operation-list">
                          {parsedProgressEnvelope.result.operations.map((operation, index) => (
                            <article key={`${operation.path ?? 'op'}-${index}`} className="progress-operation-card">
                              <div className="queue-detail-row progress-operation-header">
                                <code>{operation.path ?? 'unknown file'}</code>
                                <small>{operation.type ?? 'replace_file'}</small>
                              </div>
                              <p>{summarizeOperationContent(operation.content)}</p>
                            </article>
                          ))}
                        </div>
                      ) : null}
                      <details className="progress-raw-details">
                        <summary>Raw payload</summary>
                        <pre className="progress-raw-pre">{displayedProgressText}</pre>
                      </details>
                    </div>
                  ) : (
                    <pre className="progress-raw-pre">
                      {displayedProgressText || '작업이 시작되면 여기에서 단계와 worklog가 스트림처럼 보입니다.'}
                    </pre>
                  )}
                </div>
              </section>

              <section className="builder-queue-shell">
                <button type="button" className="queue-summary-toggle queue-summary-toggle-rail" onClick={() => setIsQueueExpanded((current) => !current)}>
                  <div>
                    <p className="eyebrow">Queue</p>
                    <h2>{queueDepth} active</h2>
                  </div>
                  <div className="queue-summary-copy">
                    <span>{queueSummaryText}</span>
                    <span>{isQueueExpanded ? '접기' : '펼치기'}</span>
                  </div>
                </button>
                {isQueueExpanded ? (
                  <div className="queue-list compact-queue-list compact-queue-list-rail">
                    {session.jobs.length === 0 ? (
                      <div className="empty-state empty-state-rail">진행 중인 작업이 없으면 queue는 비워지고, 완료된 작업은 backlog로 이동합니다.</div>
                    ) : (
                      session.jobs.map((job) => (
                        <article key={job.id} className="queue-item-card compact-queue-item compact-queue-item-rail">
                          <div className="queue-item-header">
                            <div>
                              <strong>{PROVIDER_MAP[job.providerId].label}</strong>
                              <p>
                                {statusLabel(job.status)} · {stageLabel(job.stage)}
                              </p>
                            </div>
                            <span className={`status-badge status-${job.status}`}>{statusLabel(job.status)}</span>
                          </div>
                          <p className="queue-message">{job.helperMessage ?? `${job.chunk} 처리 중`}</p>
                        </article>
                      ))
                    )}
                  </div>
                ) : null}
              </section>

              <section className="builder-composer-shell">
                <div className="builder-composer-header">
                  <div>
                    <p className="eyebrow">Bark pad</p>
                    <h2>Queue the next diff</h2>
                  </div>
                  <div className="panel-pill-group">
                    <span className="panel-pill">{activeProvider.label}</span>
                    <span className="panel-pill panel-pill-neutral">{session.pendingBuffer.length}/{CHUNK_SIZE}</span>
                    <span className="panel-pill panel-pill-neutral">{selectedCategory}</span>
                  </div>
                </div>
                <textarea
                  className="bark-pad bark-pad-rail"
                  value={barkPadValue}
                  onChange={handleBarkPadChange}
                  onKeyDown={handleKeyDown}
                  onBeforeInput={handleBeforeInput}
                  onCompositionStart={handleCompositionStart}
                  onCompositionUpdate={handleCompositionUpdate}
                  onCompositionEnd={handleCompositionEnd}
                  onPaste={handlePaste}
                  onDrop={(event) => event.preventDefault()}
                  placeholder="Mash the keyboard. Safe printable text is captured, dangerous keys are blocked, and every 20 characters become one bark diff job."
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <div className="bark-meta-row bark-meta-row-rail">
                  <span>Last blocked key: {lastBlockedKey ?? 'None'}</span>
                  <span>Future chunks route through {activeProvider.label}</span>
                </div>
              </section>
            </aside>

              <section className="builder-canvas">
                <div className="builder-canvas-topbar">
                  <div className="builder-canvas-titleblock">
                    <p className="eyebrow">Live demo</p>
                    <h2>{displayPreviewTitle}</h2>
                    <p className="preview-caption">{displayPreviewSummary}</p>
                  </div>
                  <div className="builder-canvas-badges">
                    <span className="panel-pill">{streamProviderLabel}</span>
                    <span className="panel-pill panel-pill-neutral">{livePhase}</span>
                  </div>
                </div>
                <section className="builder-preview-shell surface-card">
                  <div className="preview-chrome">
                    <div className="preview-chrome-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="preview-chrome-address">
                      {displayPreviewTitle}
                    </div>
                    <div className="preview-chrome-status">{livePhase}</div>
                  </div>
                  <iframe
                    title="vibe-barking preview"
                    className="preview-frame preview-frame-large"
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                  srcDoc={previewDocument}
                />
              </section>
            </section>
          </main>

          {isAddProviderOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="add-provider-title">
                <div className="modal-header">
                  <div>
                    <p className="eyebrow">Add provider</p>
                    <h2 id="add-provider-title">Connect another bark interpreter</h2>
                  </div>
                  <button type="button" className="ghost-button" onClick={closeAddProviderModal}>
                    Close
                  </button>
                </div>
                {setupSurface}
              </div>
            </div>
          ) : null}

          {isBacklogOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div className="modal-shell backlog-modal" role="dialog" aria-modal="true" aria-labelledby="backlog-title">
                <div className="modal-header">
                  <div>
                    <p className="eyebrow">Backlog</p>
                    <h2 id="backlog-title">Completed bark history</h2>
                  </div>
                  <div className="modal-header-actions">
                    <button type="button" className="ghost-button ghost-button-danger" onClick={() => void handleResetBacklog()}>
                      Reset all
                    </button>
                    <button type="button" className="ghost-button" onClick={() => setIsBacklogOpen(false)}>
                      Close
                    </button>
                  </div>
                </div>
                <div className="queue-list">
                  {backlogPage?.entries.length ? (
                    backlogPage.entries.map((entry) => (
                      <article key={`${entry.id}-${entry.completedAt}`} className="queue-item-card backlog-item-card">
                        <div className="queue-item-header">
                          <div>
                            <strong>{PROVIDER_MAP[entry.provider].label}</strong>
                            <p>
                              {formatTime(entry.completedAt)} · {entry.chunk}
                            </p>
                          </div>
                          <span className={`status-badge status-${entry.status}`}>{statusLabel(entry.status)}</span>
                        </div>
                        <div className="queue-detail-row">
                          <code>{entry.model ?? PROVIDER_MAP[entry.provider].defaultModel}</code>
                          <small>
                            {stageLabel(entry.stage)} · {entry.resultMode ?? 'fallback'}
                          </small>
                        </div>
                        <p className="queue-message">{entry.preview?.summary ?? entry.error ?? 'No summary'}</p>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state">저장된 backlog가 없습니다.</div>
                  )}
                </div>
                <div className="modal-pagination-row">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={!backlogPage || backlogPage.page <= 1}
                    onClick={() => setBacklogPageNumber((current) => Math.max(1, current - 1))}
                  >
                    Previous 10
                  </button>
                  <span className="panel-pill panel-pill-neutral">
                    {backlogPage ? `${backlogPage.page} / ${backlogPage.totalPages}` : '1 / 1'}
                  </span>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={!backlogPage || backlogPage.page >= backlogPage.totalPages}
                    onClick={() => setBacklogPageNumber((current) => current + 1)}
                  >
                    Next 10
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

interface SetupSurfaceProps {
  helperOnline: boolean
  setupError: SetupErrorState | null
  selectedProviderId: ProviderId | null
  providerDrafts: Record<ProviderId, ProviderDraft>
  providerSummaries: Record<ProviderId, ProviderMetaSummary | null>
  connectedProviderIds: ProviderId[]
  onSelectProvider: (providerId: ProviderId) => void
  onDraftChange: (providerId: ProviderId, field: keyof ProviderDraft, value: string) => void
  onValidate: () => void
  isValidating: boolean
  onResetSelection: () => void
  isModal: boolean
  selectedCategory: PromptCategory
  onSelectCategory: (category: PromptCategory) => void
}

function SetupSurface({
  helperOnline,
  setupError,
  selectedProviderId,
  providerDrafts,
  providerSummaries,
  connectedProviderIds,
  onSelectProvider,
  onDraftChange,
  onValidate,
  isValidating,
  onResetSelection,
  isModal,
  selectedCategory,
  onSelectCategory,
}: SetupSurfaceProps) {
  const selectedProvider = selectedProviderId ? PROVIDER_MAP[selectedProviderId] : null
  const selectedDraft = selectedProviderId ? providerDrafts[selectedProviderId] : null

  return (
    <section className={`setup-shell surface-card ${isModal ? 'setup-shell-modal' : ''}`}>
      <div className="setup-shell-header">
        <div>
          <p className="eyebrow">{isModal ? 'Add provider' : 'Setup gate'}</p>
          <h1>{isModal ? 'Connect another interpreter' : 'Pick one bark interpreter'}</h1>
          <p className="hero-copy">
            {isModal
              ? 'Reuse the setup flow without leaving the workspace.'
              : 'Validate one provider successfully before entering the live bark → diff → apply workspace.'}
          </p>
        </div>
        <div className={`helper-health ${helperOnline ? 'helper-health-online' : 'helper-health-offline'}`}>
          {helperOnline ? 'Helper online' : 'Helper offline'}
        </div>
      </div>

      {setupError ? (
        <div className="setup-error-card" role="alert">
          <p className="eyebrow">Validation failed</p>
          <h2>{PROVIDER_MAP[setupError.providerId].label} could not be unlocked</h2>
          <p>{setupError.message}</p>
          <button type="button" className="primary-button" onClick={onResetSelection}>
            Choose another provider
          </button>
        </div>
      ) : (
        <div className="setup-grid">
          <div className="setup-provider-list">
            {PROVIDER_DEFINITIONS.map((provider) => {
              const selected = provider.id === selectedProviderId
              const summary = providerSummaries[provider.id]
              const alreadyConnected = connectedProviderIds.includes(provider.id)
              return (
                <button
                  key={provider.id}
                  type="button"
                  className={`setup-provider-card ${selected ? 'setup-provider-card-selected' : ''}`}
                  onClick={() => onSelectProvider(provider.id)}
                >
                  <div className="setup-provider-card-header">
                    <strong>{provider.label}</strong>
                    <span className={`transport-badge transport-${provider.transport}`}>{provider.transport}</span>
                  </div>
                  <p>{provider.summary}</p>
                  <div className="setup-provider-card-footer">
                    <small>{provider.envHint}</small>
                    {summary?.configured || alreadyConnected ? <span className="saved-badge">Saved</span> : null}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="setup-form-card">
            {selectedProvider && selectedDraft ? (
              <>
                <div>
                  <p className="eyebrow">Selected provider</p>
                  <h2>{selectedProvider.label}</h2>
                  <p className="setup-form-copy">
                    {selectedProvider.transport === 'cli'
                      ? 'Point the helper at the local CLI command, then validate before entering the builder workspace.'
                      : 'Provide the API credential once, validate it through the helper, and then enter the builder workspace.'}
                  </p>
                </div>
                <label>
                  <span>{selectedProvider.transport === 'cli' ? 'CLI command' : selectedProvider.secretLabel}</span>
                  <input
                    type={selectedProvider.transport === 'cli' ? 'text' : 'password'}
                    value={selectedProvider.transport === 'cli' ? selectedDraft.command : selectedDraft.secret}
                    onChange={(event) =>
                      onDraftChange(
                        selectedProvider.id,
                        selectedProvider.transport === 'cli' ? 'command' : 'secret',
                        event.target.value,
                      )
                    }
                    placeholder={
                      selectedProvider.transport === 'cli'
                        ? selectedDraft.command || `Loaded from ${selectedProvider.envHint}`
                        : `Loaded from ${selectedProvider.envHint}`
                    }
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                </label>
                <label>
                  <span>Category</span>
                  <div className="category-chip-row">
                    {SUPPORTED_CATEGORIES.map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`provider-chip ${category === selectedCategory ? 'provider-chip-active' : ''}`}
                        onClick={() => onSelectCategory(category)}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  <span>Model hint</span>
                  <input
                    type="text"
                    value={selectedDraft.model}
                    onChange={(event) => onDraftChange(selectedProvider.id, 'model', event.target.value)}
                    placeholder={selectedProvider.defaultModel}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                </label>
                <div className="setup-actions-row">
                  <button type="button" className="primary-button" onClick={onValidate} disabled={isValidating || !helperOnline}>
                    {isValidating ? 'Validating…' : isModal ? 'Validate & add' : 'Validate & enter'}
                  </button>
                </div>
              </>
            ) : (
              <div className="setup-empty-state">
                <p className="eyebrow">Step 1</p>
                <h2>Select a bark interpreter</h2>
                <p>
                  Choose one provider on the left. We only unlock the workspace after one successful validation, so the main screen stays focused on barking, diffing, and previewing.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default App
