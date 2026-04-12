import { randomUUID } from "node:crypto";

import { framePrompt } from "../prompts/frame-prompt.ts";
import type {
	BuilderStage,
	BuilderStageLogEntry,
	JobRecord,
	PreviewDocument,
	ProviderGenerationResult,
	QueueEnqueueInput,
} from "../types.ts";

interface JobQueueOptions {
	processJob: (
		job: JobRecord,
		controls: {
			update: (partial: Partial<JobRecord>) => JobRecord | undefined;
			get: () => JobRecord | undefined;
		},
	) => Promise<ProviderGenerationResult>;
	onTerminalState?: (job: JobRecord) => Promise<void> | void;
	getCurrentPreview?: () => PreviewDocument | undefined;
}

export class JobQueue {
	private readonly jobs = new Map<string, JobRecord>();
	private readonly queue: string[] = [];
	private readonly idleWaiters: Array<() => void> = [];
	private readonly processJob: JobQueueOptions["processJob"];
	private readonly onTerminalState?: JobQueueOptions["onTerminalState"];
	private readonly getCurrentPreview?: JobQueueOptions["getCurrentPreview"];
	private sequence = 0;
	private running = false;

	constructor({ processJob, onTerminalState, getCurrentPreview }: JobQueueOptions) {
		this.processJob = processJob;
		this.onTerminalState = onTerminalState;
		this.getCurrentPreview = getCurrentPreview;
	}

	enqueue(input: QueueEnqueueInput): JobRecord {
		this.sequence += 1;
		const now = new Date().toISOString();
		const currentPreview = this.getCurrentPreview?.();
		const prompt = framePrompt({
			chunk: input.chunk,
			category: input.category,
			sequence: this.sequence,
			currentPreviewSummary: currentPreview?.summary,
			currentPreview,
		});

		const job: JobRecord = {
			id: input.jobId?.trim() || randomUUID(),
			provider: input.provider,
			chunk: input.chunk.trim(),
			category: prompt.category,
			model: input.model,
			sequence: this.sequence,
			status: "queued",
			createdAt: now,
			updatedAt: now,
			prompt,
			stage: "ciphertext_interpreting",
			thinking: [],
			stageLog: [this.createStageLogEntry("ciphertext_interpreting", "Queued the bark chunk for interpretation.", now)],
		};

		this.jobs.set(job.id, job);
		this.queue.push(job.id);
		void this.pump();

		return job;
	}

	list(): JobRecord[] {
		return [...this.jobs.values()].sort(
			(left, right) => left.sequence - right.sequence,
		);
	}

	listActive(): JobRecord[] {
		return this.list().filter(
			(job) => job.status !== "completed" && job.status !== "failed",
		);
	}

	get(id: string): JobRecord | undefined {
		return this.jobs.get(id);
	}

	onIdle(): Promise<void> {
		if (!this.running && this.queue.length === 0) {
			return Promise.resolve();
		}

		return new Promise((resolve) => {
			this.idleWaiters.push(resolve);
		});
	}

	private async pump(): Promise<void> {
		if (this.running) {
			return;
		}

		this.running = true;

		try {
			while (this.queue.length > 0) {
				const jobId = this.queue.shift();
				if (!jobId) {
					continue;
				}

				const current = this.jobs.get(jobId);
				if (!current) {
					continue;
				}

				const currentPreview = this.getCurrentPreview?.();
				const processingState = this.updateJob(jobId, {
					status: "processing",
					stage: "ciphertext_interpreting",
					prompt: framePrompt({
						chunk: current.chunk,
						category: current.category,
						sequence: current.sequence,
						currentPreviewSummary: currentPreview?.summary,
						currentPreview,
					}),
				});
				if (!processingState) {
					continue;
				}

				try {
					const result = await this.processJob(processingState, {
						update: (partial) => this.updateJob(jobId, partial),
						get: () => this.jobs.get(jobId),
					});
					const job = this.jobs.get(jobId);
					if (!job) {
						continue;
					}

					this.jobs.set(jobId, {
						...job,
						status: "completed",
						stage: "applied",
						updatedAt: new Date().toISOString(),
						streamText: job.streamText,
						thinking: job.thinking,
						stageLog: job.stageLog,
						outputText: result.outputText,
						preview: result.preview,
						resultMode: result.resultMode,
					});
					await this.onTerminalState?.(this.jobs.get(jobId)!);
				} catch (error) {
					const job = this.jobs.get(jobId);
					if (!job) {
						continue;
					}

					this.jobs.set(jobId, {
						...job,
						status: "failed",
						updatedAt: new Date().toISOString(),
						error: error instanceof Error ? error.message : "Job failed.",
					});
					await this.onTerminalState?.(this.jobs.get(jobId)!);
				}
			}
		} finally {
			this.running = false;
			if (this.queue.length === 0) {
				this.resolveIdleWaiters();
			}
		}
	}

	private updateJob(jobId: string, partial: Partial<JobRecord>): JobRecord | undefined {
		const current = this.jobs.get(jobId);
		if (!current) {
			return undefined;
		}

		const next = {
			...current,
			...partial,
			updatedAt: new Date().toISOString(),
		};
		this.jobs.set(jobId, next);
		return next;
	}

	private createStageLogEntry(
		stage: BuilderStage,
		message: string,
		at = new Date().toISOString(),
	): BuilderStageLogEntry {
		return {
			stage,
			message,
			at,
		};
	}

	private resolveIdleWaiters(): void {
		while (this.idleWaiters.length > 0) {
			this.idleWaiters.shift()?.();
		}
	}
}
