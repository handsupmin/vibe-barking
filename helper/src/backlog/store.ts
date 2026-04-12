import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { BacklogEntry, JobRecord, PreviewDocument } from "../types.ts";

interface BacklogStoreOptions {
	cwd?: string;
}

interface BacklogPageResult {
	entries: BacklogEntry[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
}

const BACKLOG_FILE = join(".data", "backlog.json");

export class BacklogStore {
	private readonly filePath: string;

	constructor({ cwd = process.cwd() }: BacklogStoreOptions = {}) {
		this.filePath = join(cwd, BACKLOG_FILE);
	}

	async appendFromJob(job: JobRecord): Promise<BacklogEntry> {
		const entries = this.readAll();
		const nextEntry: BacklogEntry = {
			id: job.id,
			provider: job.provider,
			chunk: job.chunk,
			category: job.category,
			model: job.model,
			sequence: job.sequence,
			status: job.status === "failed" ? "failed" : "completed",
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			completedAt: job.updatedAt,
			stage: job.stage,
			stageLog: job.stageLog,
			resultMode: job.resultMode,
			outputText: job.outputText,
			preview: job.preview,
			error: job.error,
		};

		entries.unshift(nextEntry);
		await this.writeAll(entries);
		return nextEntry;
	}

	listPage({
		page = 1,
		pageSize = 10,
	}: {
		page?: number;
		pageSize?: number;
	} = {}): BacklogPageResult {
		const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
		const normalizedPageSize =
			Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 10;
		const entries = this.readAll();
		const total = entries.length;
		const totalPages = total === 0 ? 1 : Math.ceil(total / normalizedPageSize);
		const safePage = Math.min(normalizedPage, totalPages);
		const start = (safePage - 1) * normalizedPageSize;
		const pageEntries = entries.slice(start, start + normalizedPageSize);

		return {
			entries: pageEntries,
			page: safePage,
			pageSize: normalizedPageSize,
			total,
			totalPages,
		};
	}

	latestSuccessfulPreview(): PreviewDocument | undefined {
		return this.readAll().find((entry) => entry.status === "completed" && entry.preview)?.preview;
	}

	async clearAll(): Promise<void> {
		await this.writeAll([]);
	}

	private readAll(): BacklogEntry[] {
		if (!existsSync(this.filePath)) {
			return [];
		}

		try {
			const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
			return Array.isArray(parsed) ? (parsed as BacklogEntry[]) : [];
		} catch {
			return [];
		}
	}

	private async writeAll(entries: BacklogEntry[]): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf8");
	}
}
