import type {
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

    return {
      accepted: response.ok,
      helperAvailable: response.ok,
      jobId: request.jobId,
      remoteJobId:
        typeof payload?.remoteJobId === 'string' ? payload.remoteJobId : undefined,
      status:
        response.ok && typeof payload?.status === 'string'
          ? (payload.status as QueueDispatchResponse['status'])
          : response.ok
            ? 'completed'
            : 'failed',
      summary:
        typeof payload?.summary === 'string'
          ? payload.summary
          : response.ok
            ? 'Helper accepted the bark chunk.'
            : undefined,
      previewHtml:
        typeof payload?.previewHtml === 'string' ? payload.previewHtml : undefined,
      message:
        typeof payload?.message === 'string'
          ? payload.message
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
