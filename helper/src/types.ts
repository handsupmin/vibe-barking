export const SUPPORTED_PROVIDERS = [
	"openai",
	"gemini",
	"claude",
	"claude-code",
	"codex",
] as const;
export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number];

export const SUPPORTED_CATEGORIES = [
	"캐주얼게임",
	"아케이드 게임",
	"디펜스게임",
	"보드게임",
	"유틸리티",
	"3D게임(threejs)",
	"세상에 없는 엄청난 무언가",
] as const;
export type PromptCategory = (typeof SUPPORTED_CATEGORIES)[number];
export const DEFAULT_CATEGORY: PromptCategory = "캐주얼게임";

export const JOB_STATUSES = [
	"queued",
	"processing",
	"completed",
	"failed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface PromptFrame {
	system: string;
	user: string;
	category: PromptCategory;
	chunk: string;
	sequence: number;
}

export const BUILDER_STAGES = [
	"ciphertext_interpreting",
	"working",
	"applying",
	"applied",
] as const;
export type BuilderStage = (typeof BUILDER_STAGES)[number];
export type BuilderResultMode = "patch" | "snapshot" | "fallback";

export interface BuilderPatchOperation {
	type: "replace_file";
	path: string;
	content: string;
}

export interface BuilderPatchPayload {
	mode: "patch";
	operations: BuilderPatchOperation[];
}

export interface BuilderSnapshotPayload {
	mode: "snapshot";
	snapshot: PreviewDocument;
}

export interface BuilderResponseEnvelope {
	stage: BuilderStage;
	thinking: string[];
	result?: BuilderPatchPayload | BuilderSnapshotPayload;
}

export interface BuilderStageLogEntry {
	stage: BuilderStage;
	message: string;
	at: string;
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
	envelope?: BuilderResponseEnvelope;
	resultMode?: BuilderResultMode;
}

export interface QueueEnqueueInput {
	jobId?: string;
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
	stage: BuilderStage;
	thinking: string[];
	stageLog: BuilderStageLogEntry[];
	resultMode?: BuilderResultMode;
	streamText?: string;
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
	stage: BuilderStage;
	thinking: string[];
	stageLog: BuilderStageLogEntry[];
	resultMode?: BuilderResultMode;
	streamText?: string;
	outputText?: string;
	preview?: PreviewDocument;
	error?: string;
}

export interface BacklogEntry {
	id: string;
	provider: ProviderId;
	chunk: string;
	category: PromptCategory;
	model?: string;
	sequence: number;
	status: Extract<JobStatus, "completed" | "failed">;
	createdAt: string;
	updatedAt: string;
	completedAt: string;
	stage: BuilderStage;
	stageLog: BuilderStageLogEntry[];
	resultMode?: BuilderResultMode;
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
	details?: Record<string, string | boolean | number | null>;
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
	currentPreview?: PreviewDocument;
	onProgressDelta?: (delta: string) => void;
}
