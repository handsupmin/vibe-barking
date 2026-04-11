import { useEffect, useMemo, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'

import './index.css'
import {
  CHUNK_SIZE,
  INITIAL_PROVIDER_DRAFTS,
  PROVIDER_DEFINITIONS,
  PROVIDER_MAP,
  type ProviderDraft,
  type ProviderId,
  type ProviderMetaSummary,
  type QueueJob,
} from './lib/contracts'
import { applyTextToQueue, isBlockedKeyboardEvent, sanitizeBarkText } from './lib/guardedInput'
import { dispatchQueuedJob, fetchHelperMeta, validateProvider } from './lib/helperClient'
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

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: QueueJob['status'] | 'processing'): string {
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
  const [session, setSession] = useState<SessionState>(INITIAL_SESSION)
  const [helperMessage, setHelperMessage] = useState(
    'Pick one interpreter, validate it, and then start barking into the pipeline.',
  )
  const [lastBlockedKey, setLastBlockedKey] = useState<string | null>(null)

  const activeWorkspaceProviderId = activeProviderId ?? connectedProviderIds[0] ?? null
  const activeProvider = activeWorkspaceProviderId ? PROVIDER_MAP[activeWorkspaceProviderId] : null
  const activeDraft = activeWorkspaceProviderId ? providerDrafts[activeWorkspaceProviderId] : null
  const selectedSetupProvider = setupProviderId ? PROVIDER_MAP[setupProviderId] : null
  const selectedSetupDraft = setupProviderId ? providerDrafts[setupProviderId] : null

  const queuedLocalJob = useMemo(
    () => session.jobs.find((job) => job.status === 'queued' && !job.remoteJobId),
    [session.jobs],
  )
  const needsPolling = session.jobs.some(
    (job) => job.remoteJobId && ['queued', 'processing', 'dispatching'].includes(job.status),
  )
  const queueDepth = session.jobs.length
  const completedJobs = session.jobs.filter((job) => job.status === 'completed')
  const latestCompletedJob = completedJobs.at(-1)

  const previewDocument = useMemo(
    () =>
      latestCompletedJob?.previewHtml ??
      buildPreviewShell({
        providerLabel: activeProvider?.label ?? 'No provider yet',
        queueDepth,
        pendingCharacters: session.pendingBuffer.length,
        latestChunk: latestCompletedJob?.chunk,
        latestSummary: latestCompletedJob?.resultSummary,
        helperMessage,
      }),
    [activeProvider?.label, helperMessage, latestCompletedJob, queueDepth, session.pendingBuffer.length],
  )

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const meta = await fetchHelperMeta()
      if (cancelled) {
        return
      }

      setHelperOnline(Boolean(meta))

      if (!meta) {
        setHelperMessage('Local helper unavailable. Start the helper to validate a provider and enter the workspace.')
        setViewMode('setup')
        return
      }

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
      setSetupProviderId(bootstrapState.setupProviderId)
      setViewMode(bootstrapState.shouldEnterWorkspace ? 'workspace' : 'setup')
      setHelperMessage(
        bootstrapState.shouldEnterWorkspace && bootstrapState.activeProviderId
          ? `${PROVIDER_MAP[bootstrapState.activeProviderId].label} is ready. Bark pad, chunk pipeline, and preview are live.`
          : 'Pick one interpreter and validate it before entering the workspace.',
      )
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!queuedLocalJob) {
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setSession((current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
          job.id === queuedLocalJob.id
            ? {
                ...job,
                status: 'dispatching',
                helperMessage: `Sending bark chunk to ${PROVIDER_MAP[job.providerId].label}…`,
              }
            : job,
        ),
      }))
    })

    void dispatchQueuedJob({
      providerId: queuedLocalJob.providerId,
      jobId: queuedLocalJob.id,
      chunk: queuedLocalJob.chunk,
      model: queuedLocalJob.model,
    }).then((response) => {
      if (cancelled) {
        return
      }

      setHelperMessage(response.message)
      setSession((current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
          job.id === queuedLocalJob.id
            ? {
                ...job,
                status: response.status,
                remoteJobId: response.remoteJobId ?? job.remoteJobId ?? job.id,
                resultSummary: response.summary ?? job.resultSummary,
                previewHtml: response.previewHtml ?? job.previewHtml,
                helperMessage: response.message,
              }
            : job,
        ),
      }))
    })

    return () => {
      cancelled = true
    }
  }, [queuedLocalJob])

  useEffect(() => {
    if (!needsPolling) {
      return
    }

    let cancelled = false

    async function pollJobs() {
      const meta = await fetch('/api/jobs')
      if (!meta.ok) {
        return
      }
      const payload = (await meta.json()) as {
        jobs?: Array<{
          id: string
          status: QueueJob['status']
          error?: string
          preview?: {
            title: string
            summary: string
            html: string
            css: string
            javascript: string
          }
        }>
      }
      if (cancelled || !Array.isArray(payload.jobs)) {
        return
      }

      const helperJobs = new Map(payload.jobs.map((job) => [job.id, job]))

      setSession((current) => ({
        ...current,
        jobs: current.jobs.map((job) => {
          const remoteId = job.remoteJobId
          if (!remoteId) {
            return job
          }

          const helperJob = helperJobs.get(remoteId)
          if (!helperJob) {
            return job
          }

          return {
            ...job,
            status: helperJob.status,
            helperMessage:
              helperJob.status === 'processing'
                ? `Helper is processing ${PROVIDER_MAP[job.providerId].label} chunk…`
                : helperJob.error ?? helperMessage,
            resultSummary: helperJob.preview?.summary ?? job.resultSummary,
            previewHtml: helperJob.preview
              ? buildHtmlFromPreview(helperJob.preview)
              : job.previewHtml,
          }
        }),
      }))
    }

    void pollJobs()
    const intervalId = window.setInterval(() => {
      void pollJobs()
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [helperMessage, needsPolling])

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
        model: activeDraft.model,
      })) as QueueJob[]

      return {
        pendingBuffer: next.pendingBuffer,
        transcript: next.transcript,
        jobs: [...current.jobs, ...appendedJobs],
      }
    })

    setLastBlockedKey(null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isBlockedKeyboardEvent(event)) {
      event.preventDefault()
      setLastBlockedKey(event.key)
    }
  }

  function handleBeforeInput(event: FormEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as InputEvent
    if (!nativeEvent.data) {
      return
    }

    event.preventDefault()
    appendBarkText(nativeEvent.data)
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
    } else {
      setViewMode('workspace')
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

  function handleSwitchProvider(providerId: ProviderId) {
    setActiveProviderId(providerId)
    persistWorkspaceState(buildConnectedProviderState(connectedProviderIds, providerId))
    setHelperMessage(`${PROVIDER_MAP[providerId].label} is now active for future bark chunks.`)
  }

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
          <header className="workspace-header surface-card">
            <div>
              <p className="eyebrow">local parody, real queue</p>
              <h1>vibe-barking</h1>
              <p className="hero-copy">
                One interpreter at a time, one calm workspace. Add more later without dragging setup back into the main flow.
              </p>
            </div>
            <div className="workspace-actions">
              <div className="provider-switcher" role="tablist" aria-label="Connected bark interpreters">
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
              <button type="button" className="ghost-button" onClick={openAddProviderModal}>
                + Add provider
              </button>
            </div>
          </header>

          <main className="workspace-grid">
            <section className="workspace-left-column">
              <article className="surface-card workspace-panel">
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">Bark pad</p>
                    <h2>Guarded input</h2>
                  </div>
                  <div className="panel-pill-group">
                    <span className="panel-pill">{activeProvider.label}</span>
                    <span className="panel-pill panel-pill-neutral">
                      {session.pendingBuffer.length}/{CHUNK_SIZE}
                    </span>
                  </div>
                </div>
                <textarea
                  className="bark-pad"
                  value={session.transcript}
                  onChange={() => undefined}
                  onKeyDown={handleKeyDown}
                  onBeforeInput={handleBeforeInput}
                  onPaste={handlePaste}
                  onDrop={(event) => event.preventDefault()}
                  placeholder="Mash the keyboard. Safe printable text is captured, dangerous keys are blocked, and every 20 characters become one bark job."
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <div className="bark-meta-row">
                  <span>Last blocked key: {lastBlockedKey ?? 'None'}</span>
                  <span>Future chunks route through {activeProvider.label}</span>
                </div>
              </article>

              <article className="surface-card workspace-panel">
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">Chunk pipeline</p>
                    <h2>Queued bark jobs</h2>
                  </div>
                  <div className="panel-pill-group">
                    <span className="panel-pill panel-pill-neutral">{session.jobs.length} jobs</span>
                  </div>
                </div>

                <div className="queue-list">
                  {session.jobs.length === 0 ? (
                    <div className="empty-state">
                      Choose a provider, validate it, then start barking. The first 20-character chunk will appear here.
                    </div>
                  ) : (
                    session.jobs.map((job) => (
                      <article key={job.id} className="queue-item-card">
                        <div className="queue-item-header">
                          <div>
                            <strong>{PROVIDER_MAP[job.providerId].label}</strong>
                            <p>
                              {formatTime(job.createdAt)} · {job.chunk}
                            </p>
                          </div>
                          <span className={`status-badge status-${job.status}`}>{statusLabel(job.status)}</span>
                        </div>
                        <div className="queue-detail-row">
                          <code>{job.model ?? PROVIDER_MAP[job.providerId].defaultModel}</code>
                          {job.remoteJobId ? <small>helper job: {job.remoteJobId}</small> : null}
                        </div>
                        {job.resultSummary ? <p className="queue-summary">{job.resultSummary}</p> : null}
                        {job.helperMessage ? <p className="queue-message">{job.helperMessage}</p> : null}
                        {job.error ? <p className="queue-error">{job.error}</p> : null}
                      </article>
                    ))
                  )}
                </div>
              </article>
            </section>

            <section className="workspace-preview-column">
              <article className="surface-card preview-panel">
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">Preview</p>
                    <h2>Isolated browser shell</h2>
                  </div>
                  <span className="panel-pill">sandboxed iframe</span>
                </div>
                <iframe
                  title="vibe-barking preview"
                  className="preview-frame"
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  srcDoc={previewDocument}
                />
                <div className="preview-summary-block">
                  <strong>Latest summary</strong>
                  <p>{latestCompletedJob?.resultSummary ?? helperMessage}</p>
                </div>
              </article>
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
              : 'Validate one provider successfully before entering the Bark pad, chunk pipeline, and preview workspace.'}
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
                      ? 'Point the helper at the local CLI command, then validate before entering the workspace.'
                      : 'Provide the API credential once, validate it through the helper, and then enter the workspace.'}
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
                  Choose one provider on the left. We only unlock the workspace after one successful validation, so the main screen stays focused on barking, chunking, and previewing.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
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

export default App
