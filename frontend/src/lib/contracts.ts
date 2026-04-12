export const CHUNK_SIZE = 20

export type ProviderId = 'openai' | 'gemini' | 'claude' | 'claude-code' | 'codex'
export const SUPPORTED_CATEGORIES = ['캐주얼게임', '아케이드 게임', '디펜스게임', '보드게임', '유틸리티', '3D게임(threejs)', '세상에 없는 엄청난 무언가'] as const
export type PromptCategory = (typeof SUPPORTED_CATEGORIES)[number]
export type ProviderHealth = 'idle' | 'validating' | 'ready' | 'error'
export type QueueJobStatus =
  | 'queued'
  | 'dispatching'
  | 'processing'
  | 'waiting-for-helper'
  | 'completed'
  | 'failed'
export type BuilderStage = 'ciphertext_interpreting' | 'working' | 'applying' | 'applied'
export type BuilderResultMode = 'patch' | 'snapshot' | 'fallback'

export interface BuilderStageLogEntry {
  stage: BuilderStage
  message: string
  at: string
}

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

export interface ProviderMetaSummary {
  provider: ProviderId
  displayName: string
  configured: boolean
  missing: string[]
  requiresCli: boolean
  envVars: string[]
  details?: Record<string, string | boolean | number | null>
}

export interface PreviewPayload {
  title: string
  summary: string
  html: string
  css: string
  javascript: string
}

export interface HelperMetaResponse {
  providers: ProviderMetaSummary[]
  categories: string[]
  providerIds: ProviderId[]
}

export interface QueueJob {
  id: string
  chunk: string
  createdAt: string
  providerId: ProviderId
  category: PromptCategory
  model?: string
  status: QueueJobStatus
  stage: BuilderStage
  thinking: string[]
  stageLog: BuilderStageLogEntry[]
  resultMode?: BuilderResultMode
  streamText?: string
  remoteJobId?: string
  resultSummary?: string
  preview?: PreviewPayload
  previewHtml?: string
  helperMessage?: string
  error?: string
}

export interface QueueDispatchRequest {
  providerId: ProviderId
  jobId: string
  chunk: string
  category: PromptCategory
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

export interface BacklogEntry {
  id: string
  provider: ProviderId
  chunk: string
  category: PromptCategory
  model?: string
  sequence: number
  status: 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  completedAt: string
  stage: BuilderStage
  stageLog: BuilderStageLogEntry[]
  resultMode?: BuilderResultMode
  outputText?: string
  preview?: PreviewPayload
  error?: string
}

export interface BacklogPageResponse {
  entries: BacklogEntry[]
  page: number
  pageSize: number
  total: number
  totalPages: number
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
    id: 'claude-code',
    label: 'Claude Code CLI',
    summary: 'Local Claude Code lane for machines already authenticated with the Claude CLI.',
    transport: 'cli',
    secretLabel: 'CLI command',
    envHint: 'PATH -> claude',
    defaultModel: 'sonnet',
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
  'claude-code': {
    secret: 'claude',
    model: PROVIDER_MAP['claude-code'].defaultModel,
    command: 'claude',
  },
  codex: {
    secret: 'codex',
    model: PROVIDER_MAP.codex.defaultModel,
    command: 'codex',
  },
}
