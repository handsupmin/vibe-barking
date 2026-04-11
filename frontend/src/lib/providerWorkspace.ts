import {
  INITIAL_PROVIDER_DRAFTS,
  PROVIDER_DEFINITIONS,
  type ProviderId,
  type ProviderMetaSummary,
} from './contracts'

const STORAGE_KEY = 'vibe-barking.workspace'

export interface PersistedWorkspaceState {
  connectedProviderIds: ProviderId[]
  activeProviderId: ProviderId | null
  lastSuccessfulProviderId: ProviderId | null
}

export interface WorkspaceBootstrap {
  connectedProviderIds: ProviderId[]
  activeProviderId: ProviderId | null
  setupProviderId: ProviderId | null
  shouldEnterWorkspace: boolean
}

export interface ProviderConnectionState {
  connectedProviderIds: ProviderId[]
  activeProviderId: ProviderId | null
  lastSuccessfulProviderId: ProviderId
}

export const EMPTY_WORKSPACE_STATE: PersistedWorkspaceState = {
  connectedProviderIds: [],
  activeProviderId: null,
  lastSuccessfulProviderId: null,
}

export function deriveWorkspaceBootstrap(
  providerSummaries: ProviderMetaSummary[],
  persisted: PersistedWorkspaceState = EMPTY_WORKSPACE_STATE,
): WorkspaceBootstrap {
  const configuredIds = PROVIDER_DEFINITIONS.map((provider) => provider.id).filter((providerId) =>
    providerSummaries.some((summary) => summary.provider === providerId && summary.configured),
  )

  const connectedProviderIds = persisted.connectedProviderIds.filter((providerId) => configuredIds.includes(providerId))

  const lastSuccessfulProviderId = configuredIds.includes(persisted.lastSuccessfulProviderId as ProviderId)
    ? (persisted.lastSuccessfulProviderId as ProviderId)
    : null

  if (lastSuccessfulProviderId && !connectedProviderIds.includes(lastSuccessfulProviderId)) {
    connectedProviderIds.push(lastSuccessfulProviderId)
  }

  const activeProviderId = connectedProviderIds.includes(persisted.activeProviderId as ProviderId)
    ? (persisted.activeProviderId as ProviderId)
    : lastSuccessfulProviderId ?? connectedProviderIds[0] ?? null

  return {
    connectedProviderIds,
    activeProviderId,
    setupProviderId: activeProviderId ?? configuredIds[0] ?? null,
    shouldEnterWorkspace: connectedProviderIds.length > 0,
  }
}

export function loadPersistedWorkspaceState(): PersistedWorkspaceState {
  if (typeof window === 'undefined') {
    return EMPTY_WORKSPACE_STATE
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY)
    if (!rawValue) {
      return EMPTY_WORKSPACE_STATE
    }

    const parsed = JSON.parse(rawValue) as Partial<PersistedWorkspaceState>
    return {
      connectedProviderIds: Array.isArray(parsed.connectedProviderIds)
        ? parsed.connectedProviderIds.filter(isProviderId)
        : [],
      activeProviderId: isProviderId(parsed.activeProviderId) ? parsed.activeProviderId : null,
      lastSuccessfulProviderId: isProviderId(parsed.lastSuccessfulProviderId)
        ? parsed.lastSuccessfulProviderId
        : null,
    }
  } catch {
    return EMPTY_WORKSPACE_STATE
  }
}

export function persistWorkspaceState(state: PersistedWorkspaceState): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function buildConnectedProviderState(
  connectedProviderIds: ProviderId[],
  activeProviderId: ProviderId,
  lastSuccessfulProviderId: ProviderId = activeProviderId,
): PersistedWorkspaceState {
  return {
    connectedProviderIds,
    activeProviderId,
    lastSuccessfulProviderId,
  }
}

export function applyValidatedProviderConnection({
  connectedProviderIds,
  activeProviderId,
  validatedProviderId,
  makeActive,
}: {
  connectedProviderIds: ProviderId[]
  activeProviderId: ProviderId | null
  validatedProviderId: ProviderId
  makeActive: boolean
}): ProviderConnectionState {
  const uniqueConnected = [...new Set([...connectedProviderIds, validatedProviderId])] as ProviderId[]

  return {
    connectedProviderIds: uniqueConnected,
    activeProviderId: makeActive ? validatedProviderId : activeProviderId ?? validatedProviderId,
    lastSuccessfulProviderId: validatedProviderId,
  }
}

export function mergeProviderDraftsWithConnectedCommands(
  providerDrafts: typeof INITIAL_PROVIDER_DRAFTS,
  providerSummaries: ProviderMetaSummary[],
): typeof INITIAL_PROVIDER_DRAFTS {
  const nextDrafts = { ...providerDrafts }

  for (const summary of providerSummaries) {
    const command = typeof summary.details?.command === 'string' ? summary.details.command : null
    if (!command || !(summary.provider in nextDrafts)) {
      continue
    }

    nextDrafts[summary.provider] = {
      ...nextDrafts[summary.provider],
      command,
    }
  }

  return nextDrafts
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_DEFINITIONS.some((provider) => provider.id === value)
}
