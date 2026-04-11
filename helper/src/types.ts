export const SUPPORTED_PROVIDERS = ['openai', 'gemini', 'claude', 'codex'] as const;
export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number];

export const SUPPORTED_CATEGORIES = ['landing-page', 'dashboard', 'widget', 'playground'] as const;
export type PromptCategory = (typeof SUPPORTED_CATEGORIES)[number];
export const DEFAULT_CATEGORY: PromptCategory = 'playground';

export const JOB_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface PromptFrame {
  system: string;
  user: string;
  category: PromptCategory;
  chunk: string;
  sequence: number;
}

export interface PreviewDocument {
  title: string;
  summary: string;
  html: string;
  css: string;
  javascript: string;
}

export interface ProviderGenerationResult {
  outputText: string;
  preview: PreviewDocument;
}

export interface QueueEnqueueInput {
  provider: ProviderId;
  chunk: string;
  category?: string;
  model?: string;
}

export interface JobRecord {
  id: string;
  provider: ProviderId;
  chunk: string;
  category: PromptCategory;
  model?: string;
  sequence: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  prompt: PromptFrame;
  outputText?: string;
  preview?: PreviewDocument;
  error?: string;
}

export interface PublicJobRecord {
  id: string;
  provider: ProviderId;
  chunk: string;
  category: PromptCategory;
  model?: string;
  sequence: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  outputText?: string;
  preview?: PreviewDocument;
  error?: string;
}

export interface ProviderConfigSummary {
  provider: ProviderId;
  displayName: string;
  configured: boolean;
  missing: string[];
  requiresCli: boolean;
  envVars: string[];
}

export interface ProviderValidationResult {
  ok: boolean;
  provider: ProviderId;
  message: string;
  model?: string;
  details?: Record<string, string | boolean | number | null>;
}

export interface ProviderGenerationRequest {
  prompt: PromptFrame;
  model?: string;
}
