import { useEffect, useMemo, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'

import './index.css'
import {
  CHUNK_SIZE,
  INITIAL_PROVIDER_DRAFTS,
  PROVIDER_DEFINITIONS,
  PROVIDER_MAP,
  type ProviderDraft,
  type ProviderHealth,
  type ProviderId,
  type ProviderValidationResult,
  type QueueJob,
} from './lib/contracts'
import { applyTextToQueue, isBlockedKeyboardEvent, sanitizeBarkText } from './lib/guardedInput'
import { dispatchQueuedJob, validateProvider } from './lib/helperClient'
import { buildPreviewShell } from './lib/preview'

interface ActivityItem {
  id: string
  tone: 'info' | 'success' | 'warning' | 'error'
  text: string
}

interface SessionState {
  pendingBuffer: string
  transcript: string
  jobs: QueueJob[]
}

const INITIAL_PROVIDER_HEALTH: Record<ProviderId, ProviderHealth> = {
  openai: 'idle',
  gemini: 'idle',
  claude: 'idle',
  codex: 'idle',
}

const INITIAL_PROVIDER_RESULTS: Record<ProviderId, ProviderValidationResult | null> = {
  openai: null,
  gemini: null,
  claude: null,
  codex: null,
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

function statusLabel(status: QueueJob['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'dispatching':
      return 'Dispatching'
    case 'waiting-for-helper':
      return 'Waiting for helper'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
  }
}

function App() {
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>('openai')
  const [providerDrafts, setProviderDrafts] = useState<Record<ProviderId, ProviderDraft>>(INITIAL_PROVIDER_DRAFTS)
  const [providerHealth, setProviderHealth] = useState<Record<ProviderId, ProviderHealth>>(INITIAL_PROVIDER_HEALTH)
  const [providerResults, setProviderResults] = useState<Record<ProviderId, ProviderValidationResult | null>>(INITIAL_PROVIDER_RESULTS)
  const [session, setSession] = useState<SessionState>(INITIAL_SESSION)
  const [lastBlockedKey, setLastBlockedKey] = useState<string | null>(null)
  const [helperMessage, setHelperMessage] = useState(
    'Queue shell ready. Validate a provider through the local helper to start flushing bark chunks.',
  )
  const [activity, setActivity] = useState<ActivityItem[]>([
    {
      id: 'boot',
      tone: 'info',
      text: 'Frontend shell booted. The bark pad is guarded and chunking at 20 characters.',
    },
  ])

  const selectedProvider = PROVIDER_MAP[selectedProviderId]
  const selectedDraft = providerDrafts[selectedProviderId]
  const selectedValidation = providerResults[selectedProviderId]
  const selectedReady = selectedValidation?.ok === true
  const queueDepth = session.jobs.length
  const completedJobs = session.jobs.filter((job) => job.status === 'completed')
  const latestCompletedJob = completedJobs.at(-1)

  const previewDocument = useMemo(
    () =>
      latestCompletedJob?.previewHtml ??
      buildPreviewShell({
        providerLabel: selectedProvider.label,
        queueDepth,
        pendingCharacters: session.pendingBuffer.length,
        latestChunk: latestCompletedJob?.chunk,
        latestSummary: latestCompletedJob?.resultSummary,
        helperMessage,
      }),
    [helperMessage, latestCompletedJob, queueDepth, selectedProvider.label, session.pendingBuffer.length],
  )

  function pushActivity(text: string, tone: ActivityItem['tone'] = 'info') {
    setActivity((current) => [
      {
        id: `${Date.now()}-${current.length}`,
        tone,
        text,
      },
      ...current,
    ].slice(0, 8))
  }

  function updateDraft(field: keyof ProviderDraft, value: string) {
    setProviderDrafts((current) => ({
      ...current,
      [selectedProviderId]: {
        ...current[selectedProviderId],
        [field]: value,
      },
    }))
  }

  function appendBarkText(rawText: string) {
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
        providerId: selectedProviderId,
      })) as QueueJob[]

      return {
        pendingBuffer: next.pendingBuffer,
        transcript: next.transcript,
        jobs: [...current.jobs, ...appendedJobs],
      }
    })

    setLastBlockedKey(null)
    pushActivity(`Accepted ${sanitized.length} safe character${sanitized.length === 1 ? '' : 's'} for ${selectedProvider.label}.`)
  }

  async function handleValidateProvider() {
    setProviderHealth((current) => ({
      ...current,
      [selectedProviderId]: 'validating',
    }))
    pushActivity(`Validating ${selectedProvider.label} through the local helper…`)

    const result = await validateProvider({
      providerId: selectedProviderId,
      secret: selectedProvider.transport === 'cli' ? undefined : selectedDraft.secret,
      model: selectedDraft.model,
      command: selectedProvider.transport === 'cli' ? selectedDraft.command : undefined,
    })

    setProviderResults((current) => ({
      ...current,
      [selectedProviderId]: result,
    }))
    setProviderHealth((current) => ({
      ...current,
      [selectedProviderId]: result.ok ? 'ready' : 'error',
    }))
    setHelperMessage(result.message)
    pushActivity(result.message, result.ok ? 'success' : 'warning')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isBlockedKeyboardEvent(event)) {
      event.preventDefault()
      setLastBlockedKey(event.key)
      return
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

  function requeueWaitingJobs() {
    setSession((current) => ({
      ...current,
      jobs: current.jobs.map((job) =>
        job.status === 'waiting-for-helper' && job.providerId === selectedProviderId
          ? { ...job, status: 'queued', helperMessage: undefined }
          : job,
      ),
    }))
    pushActivity('Queued waiting jobs for another helper attempt.')
  }

  useEffect(() => {
    if (!selectedReady) {
      return
    }

    const nextJob = session.jobs.find(
      (job) => job.providerId === selectedProviderId && job.status === 'queued',
    )

    if (!nextJob) {
      return
    }

    let cancelled = false

    setSession((current) => ({
      ...current,
      jobs: current.jobs.map((job) =>
        job.id === nextJob.id
          ? { ...job, status: 'dispatching', helperMessage: 'Sending bark chunk to the local helper…' }
          : job,
      ),
    }))

    void dispatchQueuedJob({
      providerId: selectedProviderId,
      jobId: nextJob.id,
      chunk: nextJob.chunk,
      model: selectedDraft.model,
    }).then((response) => {
      if (cancelled) {
        return
      }

      setHelperMessage(response.message)
      setSession((current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
          job.id === nextJob.id
            ? {
                ...job,
                status: response.status,
                remoteJobId: response.remoteJobId,
                resultSummary: response.summary ?? job.resultSummary,
                previewHtml: response.previewHtml ?? job.previewHtml,
                helperMessage: response.message,
              }
            : job,
        ),
      }))
      pushActivity(response.message, response.accepted ? 'success' : 'warning')
    })

    return () => {
      cancelled = true
    }
  }, [selectedDraft.model, selectedProviderId, selectedReady, session.jobs])

  return (
    <div className="app-shell">
      <header className="hero-card surface-card">
        <div>
          <p className="eyebrow">local parody, real queue</p>
          <h1>vibe-barking</h1>
          <p className="hero-copy">
            Chaotic paw-smashes become guarded 20-character bark jobs, queued for a local helper and previewed in an isolated browser shell.
          </p>
        </div>
        <div className="hero-stats">
          <div>
            <span className="stat-label">Queued jobs</span>
            <strong>{queueDepth}</strong>
          </div>
          <div>
            <span className="stat-label">Pending buffer</span>
            <strong>
              {session.pendingBuffer.length}/{CHUNK_SIZE}
            </strong>
          </div>
          <div>
            <span className="stat-label">Completed</span>
            <strong>{completedJobs.length}</strong>
          </div>
        </div>
      </header>

      <main className="main-grid">
        <section className="left-column">
          <article className="surface-card panel-card">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Providers</p>
                <h2>Pick the bark interpreter</h2>
              </div>
              <span className={`badge badge-${providerHealth[selectedProviderId]}`}>
                {providerHealth[selectedProviderId]}
              </span>
            </div>

            <div className="provider-grid">
              {PROVIDER_DEFINITIONS.map((provider) => {
                const active = provider.id === selectedProviderId
                const health = providerHealth[provider.id]
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={`provider-tile ${active ? 'provider-tile-active' : ''}`}
                    onClick={() => setSelectedProviderId(provider.id)}
                  >
                    <div className="provider-title-row">
                      <strong>{provider.label}</strong>
                      <span className={`mini-status mini-status-${health}`}>{health}</span>
                    </div>
                    <p>{provider.summary}</p>
                    <small>{provider.envHint}</small>
                  </button>
                )
              })}
            </div>

            <div className="provider-form">
              <label>
                <span>{selectedProvider.transport === 'cli' ? 'CLI command' : selectedProvider.secretLabel}</span>
                <input
                  type={selectedProvider.transport === 'cli' ? 'text' : 'password'}
                  value={selectedProvider.transport === 'cli' ? selectedDraft.command : selectedDraft.secret}
                  onChange={(event) =>
                    updateDraft(selectedProvider.transport === 'cli' ? 'command' : 'secret', event.target.value)
                  }
                  placeholder={selectedProvider.transport === 'cli' ? 'codex' : `Loaded from ${selectedProvider.envHint}`}
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
                  onChange={(event) => updateDraft('model', event.target.value)}
                  placeholder={selectedProvider.defaultModel}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
              <div className="provider-actions">
                <button type="button" className="primary-button" onClick={handleValidateProvider}>
                  Validate via helper
                </button>
                <button type="button" className="ghost-button" onClick={requeueWaitingJobs}>
                  Retry waiting jobs
                </button>
              </div>
              <p className="helper-note">
                {selectedValidation?.message ?? `No validation yet. The helper should confirm ${selectedProvider.envHint} before dispatch starts.`}
              </p>
            </div>
          </article>

          <article className="surface-card panel-card">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Guarded input</p>
                <h2>Bark pad</h2>
              </div>
              <span className="badge badge-info">text only</span>
            </div>

            <textarea
              className="bark-pad"
              value={session.transcript}
              onKeyDown={handleKeyDown}
              onBeforeInput={handleBeforeInput}
              onPaste={handlePaste}
              onDrop={(event) => event.preventDefault()}
              placeholder="Mash the keyboard. Functional keys are ignored; printable text gets chunked every 20 characters."
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />

            <div className="metrics-row">
              <div className="metric-pill">
                <span>Pending chunk</span>
                <strong>
                  {session.pendingBuffer.length}/{CHUNK_SIZE}
                </strong>
              </div>
              <div className="metric-pill">
                <span>Transcript length</span>
                <strong>{session.transcript.length}</strong>
              </div>
              <div className="metric-pill">
                <span>Last blocked key</span>
                <strong>{lastBlockedKey ?? 'None'}</strong>
              </div>
            </div>

            <div className="pending-buffer-card">
              <div>
                <p className="eyebrow">Pending buffer</p>
                <code>{session.pendingBuffer || '— waiting for 20 safe characters —'}</code>
              </div>
              <p>
                Jobs are minted automatically every {CHUNK_SIZE} accepted characters. Provider selection is locked per queued job.
              </p>
            </div>
          </article>

          <article className="surface-card panel-card">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Queue</p>
                <h2>Chunk pipeline</h2>
              </div>
              <span className="badge badge-info">live</span>
            </div>

            <div className="queue-list">
              {session.jobs.length === 0 ? (
                <div className="empty-state">
                  The queue is empty. Start barking and the first 20-character job will appear here.
                </div>
              ) : (
                session.jobs.map((job) => (
                  <article key={job.id} className="queue-item">
                    <div className="queue-item-header">
                      <div>
                        <strong>{job.id}</strong>
                        <p>
                          {PROVIDER_MAP[job.providerId].label} · {formatTime(job.createdAt)}
                        </p>
                      </div>
                      <span className={`badge badge-${job.status}`}>{statusLabel(job.status)}</span>
                    </div>
                    <code>{job.chunk}</code>
                    <p className="queue-message">{job.helperMessage ?? 'Waiting inside the frontend queue shell.'}</p>
                    {job.resultSummary ? <p className="queue-summary">{job.resultSummary}</p> : null}
                  </article>
                ))
              )}
            </div>
          </article>
        </section>

        <section className="right-column">
          <article className="surface-card preview-card">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Preview</p>
                <h2>Isolated browser shell</h2>
              </div>
              <span className="badge badge-info">sandboxed iframe</span>
            </div>

            <iframe
              title="vibe-barking preview"
              className="preview-frame"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={previewDocument}
            />

            <div className="preview-footer">
              <p>{helperMessage}</p>
              <small>
                The iframe is ready for helper-produced HTML. Until then it mirrors the live queue and provider state.
              </small>
            </div>
          </article>

          <article className="surface-card panel-card">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Activity</p>
                <h2>Helper & guardrail notes</h2>
              </div>
              <span className="badge badge-info">recent</span>
            </div>

            <ul className="activity-list">
              {activity.map((item) => (
                <li key={item.id} className={`activity-item activity-${item.tone}`}>
                  {item.text}
                </li>
              ))}
            </ul>
          </article>
        </section>
      </main>
    </div>
  )
}

export default App
