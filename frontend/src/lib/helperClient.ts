import type {
  BacklogPageResponse,
  HelperMetaResponse,
  ProviderValidationRequest,
  ProviderValidationResult,
  QueueDispatchRequest,
  QueueDispatchResponse,
} from './contracts'

async function readJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function validateProvider(
  request: ProviderValidationRequest,
): Promise<ProviderValidationResult> {
  const checkedAt = new Date().toISOString()

  try {
    const response = await fetch('/api/providers/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    const payload = await readJsonSafe(response)
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.error === 'string'
          ? payload.error
        : response.ok
          ? 'Provider validated by local helper.'
          : `Validation failed with status ${response.status}.`

    return {
      providerId: request.providerId,
      ok: response.ok,
      checkedAt,
      message,
    }
  } catch {
    return {
      providerId: request.providerId,
      ok: false,
      checkedAt,
      message:
        'Local helper unavailable. Start the helper server to validate this provider and dispatch queued chunks.',
    }
  }
}

export async function fetchHelperMeta(): Promise<HelperMetaResponse | null> {
  try {
    const response = await fetch('/api/meta')
    if (!response.ok) {
      return null
    }

    return (await response.json()) as HelperMetaResponse
  } catch {
    return null
  }
}

export async function fetchBacklogPage(
  page = 1,
  pageSize = 10,
): Promise<BacklogPageResponse | null> {
  try {
    const response = await fetch(`/api/backlog?page=${page}&pageSize=${pageSize}`)
    if (!response.ok) {
      return null
    }

    return (await response.json()) as BacklogPageResponse
  } catch {
    return null
  }
}

export async function clearBacklog(): Promise<boolean> {
  try {
    const response = await fetch('/api/backlog', {
      method: 'DELETE',
    })

    return response.ok
  } catch {
    return false
  }
}

export async function dispatchQueuedJob(
  request: QueueDispatchRequest,
): Promise<QueueDispatchResponse> {
  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    const payload = await readJsonSafe(response)
    const remoteJob =
      payload && typeof payload.job === 'object' && payload.job !== null
        ? (payload.job as Record<string, unknown>)
        : null
    const remoteJobId =
      typeof remoteJob?.id === 'string'
        ? remoteJob.id
        : typeof payload?.remoteJobId === 'string'
          ? payload.remoteJobId
          : undefined
    const remoteStatus =
      typeof remoteJob?.status === 'string'
        ? remoteJob.status
        : typeof payload?.status === 'string'
          ? payload.status
          : undefined

    return {
      accepted: response.ok,
      helperAvailable: response.ok,
      jobId: request.jobId,
      remoteJobId,
      status:
        response.ok && typeof remoteStatus === 'string'
          ? (remoteStatus as QueueDispatchResponse['status'])
          : response.ok
            ? 'queued'
            : 'failed',
      summary:
        typeof payload?.summary === 'string'
          ? payload.summary
          : response.ok
            ? 'Helper accepted the bark chunk and queued it for processing.'
            : undefined,
      previewHtml:
        typeof payload?.previewHtml === 'string' ? payload.previewHtml : undefined,
      message:
        typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.error === 'string'
            ? payload.error
          : response.ok
            ? 'Helper accepted the bark chunk.'
            : `Helper rejected the bark chunk with status ${response.status}.`,
    }
  } catch {
    return {
      accepted: false,
      helperAvailable: false,
      jobId: request.jobId,
      status: 'waiting-for-helper',
      message:
        'Queue is primed, but the local helper is offline. Keep typing or start the helper to flush queued bark jobs.',
    }
  }
}
