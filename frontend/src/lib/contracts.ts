export const CHUNK_SIZE = 20

export type ProviderId = 'openai' | 'gemini' | 'claude' | 'codex'
export type ProviderHealth = 'idle' | 'validating' | 'ready' | 'error'
export type QueueJobStatus =
  | 'queued'
  | 'dispatching'
  | 'waiting-for-helper'
  | 'completed'
  | 'failed'

export interface ProviderDefinition {
  id: ProviderId
  label: string
  summary: string
  transport: 'api' | 'cli'
  secretLabel: string
  envHint: string
  defaultModel: string
}

export interface ProviderDraft {
  secret: string
  model: string
  command: string
}

export interface ProviderValidationRequest {
  providerId: ProviderId
  secret?: string
  model?: string
  command?: string
}

export interface ProviderValidationResult {
  providerId: ProviderId
  ok: boolean
  checkedAt: string
  message: string
}

export interface QueueJob {
  id: string
  chunk: string
  createdAt: string
  providerId: ProviderId
  status: QueueJobStatus
  remoteJobId?: string
  resultSummary?: string
  previewHtml?: string
  helperMessage?: string
}

export interface QueueDispatchRequest {
  providerId: ProviderId
  jobId: string
  chunk: string
  model?: string
}

export interface QueueDispatchResponse {
  accepted: boolean
  helperAvailable: boolean
  jobId: string
  remoteJobId?: string
  status: QueueJobStatus
  summary?: string
  previewHtml?: string
  message: string
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI API',
    summary: 'Stable HTTP route for structured prompt framing and browser-targeted output.',
    transport: 'api',
    secretLabel: 'API key',
    envHint: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.4-mini',
  },
  {
    id: 'gemini',
    label: 'Gemini API',
    summary: 'Fast multimodal-friendly lane for chaotic bark chunks that still need clean formatting.',
    transport: 'api',
    secretLabel: 'API key',
    envHint: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'claude',
    label: 'Claude API',
    summary: 'Long-form refinement lane for turning noisy chunks into readable browser experiences.',
    transport: 'api',
    secretLabel: 'API key',
    envHint: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-5',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    summary: 'Local command runner for developers who want the parody to stay on their machine.',
    transport: 'cli',
    secretLabel: 'CLI command',
    envHint: 'PATH -> codex',
    defaultModel: 'gpt-5.4',
  },
]

export const PROVIDER_MAP = Object.fromEntries(
  PROVIDER_DEFINITIONS.map((provider) => [provider.id, provider]),
) as Record<ProviderId, ProviderDefinition>

export const INITIAL_PROVIDER_DRAFTS: Record<ProviderId, ProviderDraft> = {
  openai: {
    secret: '',
    model: PROVIDER_MAP.openai.defaultModel,
    command: '',
  },
  gemini: {
    secret: '',
    model: PROVIDER_MAP.gemini.defaultModel,
    command: '',
  },
  claude: {
    secret: '',
    model: PROVIDER_MAP.claude.defaultModel,
    command: '',
  },
  codex: {
    secret: 'codex',
    model: PROVIDER_MAP.codex.defaultModel,
    command: 'codex',
  },
}
