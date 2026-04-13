import type { IncomingHttpHeaders } from "node:http";
import { readFile } from "node:fs/promises";

import { BacklogStore } from "./backlog/store.ts";
import { loadHelperRuntimeEnv, persistProviderConfig } from "./config/env-store.ts";
import { previewToBuilderFiles } from "./preview/builder-preview.ts";
import { createProviders } from "./providers/index.ts";
import type { ProviderAdapter } from "./providers/provider.ts";
import { framePrompt } from "./prompts/frame-prompt.ts";
import { SessionOutputStore } from "./session-output/store.ts";
import { JobQueue } from "./queue/job-queue.ts";
import {
	type BuilderStage,
	type BuilderStageLogEntry,
	type JobRecord,
	type PreviewDocument,
	type PublicJobRecord,
	type QueueEnqueueInput,
	type SessionRecord,
	SUPPORTED_CATEGORIES,
	SUPPORTED_PROVIDERS,
} from "./types.ts";

interface CreateAppOptions {
	providers?: ProviderAdapter[];
	queue?: JobQueue;
	env?: NodeJS.ProcessEnv;
	fetchFn?: typeof fetch;
	cwd?: string;
}

export function createApp({
	providers,
	queue,
	fetchFn = fetch,
	cwd = process.cwd(),
	env,
}: CreateAppOptions = {}) {
	const runtimeEnv = env ?? loadHelperRuntimeEnv({ cwd, baseEnv: process.env });
	const registry =
		providers ?? createProviders({ env: runtimeEnv, fetchFn, cwd });
	const providerMap = new Map(
		registry.map((provider) => [provider.id, provider]),
	);
	const backlogStore = new BacklogStore({ cwd });
	const sessionStore = new SessionOutputStore({ cwd });
	const currentPreviewBySession = new Map<string, PreviewDocument>();
	const jobQueue =
		queue ??
		new JobQueue({
			getCurrentPreview: (sessionKey) =>
				currentPreviewBySession.get(sessionKey) ??
				sessionStore.readPreview(sessionKey) ??
				backlogStore.latestSuccessfulPreview(),
			processJob: async (job, controls) => {
				const provider = providerMap.get(job.provider);
				if (!provider) {
					throw new Error(`Unknown provider: ${job.provider}`);
				}

				const currentPreview =
					currentPreviewBySession.get(job.sessionKey) ??
					sessionStore.readPreview(job.sessionKey);
				const prompt = framePrompt({
					chunk: job.chunk,
					category: job.category,
					sequence: job.sequence,
					currentPreviewSummary: currentPreview?.summary,
					currentPreview,
				});
				controls.update({
					prompt,
					stage: "ciphertext_interpreting",
					thinking: [
						"암호문 해석 중 · bark chunk를 다음 작은 작업으로 변환하는 중.",
					],
					stageLog: appendStageLog(
						controls.get()?.stageLog ?? [],
						"ciphertext_interpreting",
						"Interpreted the bark chunk as the next tiny implementation step.",
					),
				});

				controls.update({
					stage: "working",
					thinking: [
						"작업 중 · 현재 데모를 읽고 최소 diff를 준비하는 중.",
						`작업 중 · ${provider.displayName}에게 작은 패치를 요청했어.`,
					],
					stageLog: appendStageLog(
						controls.get()?.stageLog ?? [],
						"working",
						`Asked ${provider.displayName} for the next minimal diff.`,
					),
				});

				const result = await provider.generate({
					prompt,
					model: job.model,
					currentPreview,
					onProgressDelta: (delta) => {
						const currentStream = controls.get()?.streamText ?? "";
						controls.update({ streamText: `${currentStream}${delta}` });
					},
					sessionOutputDir: sessionStore.getSessionDirectory(job.sessionKey),
				});
				const persistedPreview = sessionStore.readPreview(job.sessionKey);
				if (
					persistedPreview &&
					!previewsMatch(persistedPreview, currentPreview)
				) {
					result.preview = persistedPreview;
				}

				const providerThinking = result.envelope?.thinking?.length
					? result.envelope.thinking
					: [
						result.resultMode === "patch"
							? "Provider returned a structured patch payload."
							: result.resultMode === "snapshot"
								? "Provider returned a full snapshot fallback."
								: "Provider returned raw browser output.",
					];

				controls.update({
					stage: "applying",
					thinking: providerThinking,
					resultMode: result.resultMode,
					stageLog: appendStageLog(
						controls.get()?.stageLog ?? [],
						"applying",
						result.resultMode === "patch"
							? "Applying the returned diff to the live demo."
							: result.resultMode === "snapshot"
								? "Replacing the live demo with the returned snapshot."
								: "Using the provider output as a preview fallback.",
					),
				});

				currentPreviewBySession.set(job.sessionKey, result.preview);
				await sessionStore.writePreview(job.sessionKey, result.preview);
				controls.update({
					stage: "applied",
					stageLog: appendStageLog(
						controls.get()?.stageLog ?? [],
						"applied",
						"Applied the provider result and refreshed the live demo.",
					),
				});

				return result;
			},
			onTerminalState: async (job) => {
				await backlogStore.appendFromJob(job);
			},
		});

	return {
		queue: jobQueue,
		providers: registry,
		async fetch(request: Request): Promise<Response> {
			const url = new URL(request.url);

			if (request.method === "OPTIONS") {
				return json({ ok: true }, { status: 204 });
			}

			if (request.method === "GET" && url.pathname === "/health") {
				return json({ ok: true, helper: "vibe-barking" });
			}

			if (request.method === "GET" && url.pathname === "/api/meta") {
				return json({
					providers: registry.map((provider) => provider.configSummary()),
					categories: [...SUPPORTED_CATEGORIES],
					providerIds: [...SUPPORTED_PROVIDERS],
				});
			}

			if (request.method === "POST" && url.pathname === "/api/sessions") {
				const body = await readJson<{ sessionKey?: string }>(request);
				const session = await sessionStore.ensureSession(
					body.sessionKey ??
						`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
				);
				const preview =
					currentPreviewBySession.get(session.sessionKey) ??
					sessionStore.readPreview(session.sessionKey);
				if (preview) {
					currentPreviewBySession.set(session.sessionKey, preview);
				}
				return json(
					session,
					{ status: 201 },
				);
			}

			if (
				request.method === "POST" &&
				url.pathname === "/api/providers/validate"
			) {
				const body = await readJson<{
					providerId?: string;
					provider?: string;
					model?: string;
					secret?: string;
					command?: string;
				}>(request);
				const providerId = body.providerId ?? body.provider;
				if (!providerId || !isProviderId(providerId)) {
					return json({ error: "Unknown provider." }, { status: 400 });
				}

				const provider = providerMap.get(providerId);
				if (!provider) {
					return json({ error: "Unknown provider." }, { status: 400 });
				}

				const result = await provider.validate({
					model: body.model,
					secret: body.secret,
					command: body.command,
				});

				if (result.ok) {
					await persistProviderConfig({
						cwd,
						env: runtimeEnv,
						providerId,
						secret: body.secret,
						model: body.model,
						command: body.command,
					});
				}

				return json(result, { status: result.ok ? 200 : 400 });
			}

			if (request.method === "POST" && url.pathname === "/api/jobs") {
				const body = await readJson<QueueEnqueueInput & { providerId?: string }>(request);
				const providerId = body.providerId ?? body.provider;
				if (!providerId || !isProviderId(providerId)) {
					return json({ error: "Unknown provider." }, { status: 400 });
				}

				if (
					!body.chunk ||
					typeof body.chunk !== "string" ||
					body.chunk.trim().length === 0
				) {
					return json({ error: "Chunk is required." }, { status: 400 });
				}
				if (!body.sessionKey || typeof body.sessionKey !== "string") {
					return json({ error: "Session key is required." }, { status: 400 });
				}

				const job = jobQueue.enqueue({
					jobId: body.jobId,
					sessionKey: body.sessionKey,
					provider: providerId,
					chunk: body.chunk,
					category: body.category,
					model: body.model,
				});

				return json({ job: toPublicJob(job) }, { status: 202 });
			}

			if (request.method === "GET" && url.pathname === "/api/jobs") {
				return json({ jobs: jobQueue.listActive().map(toPublicJob) });
			}

			if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
				const jobId = url.pathname.replace("/api/jobs/", "");
				const job = jobQueue.get(jobId);
				if (!job) {
					return json({ error: "Job not found." }, { status: 404 });
				}

				return json({ job: toPublicJob(job) });
			}

			if (request.method === "GET" && url.pathname === "/api/backlog") {
				const page = Number(url.searchParams.get("page") ?? "1");
				const pageSize = Number(url.searchParams.get("pageSize") ?? "10");
				return json(backlogStore.listPage({ page, pageSize }));
			}

			if (request.method === "DELETE" && url.pathname === "/api/backlog") {
				await backlogStore.clearAll();
				return json({ ok: true }, { status: 200 });
			}

			if (request.method === "GET" && /\/outputs\/[^/]+\/live\.html$/.test(url.pathname)) {
				const sessionKey = decodeURIComponent(url.pathname.split("/")[2] ?? "");
				const liveDocument = sessionStore.buildLiveDocument(sessionKey);
				if (!liveDocument) {
					return json({ error: "Output not found." }, { status: 404 });
				}
				return new Response(liveDocument, {
					status: 200,
					headers: {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
						"access-control-allow-origin": "*",
					},
				});
			}

			if (request.method === "GET" && url.pathname.startsWith("/outputs/")) {
				const resolved = sessionStore.resolveOutputFile(url.pathname);
				if (!resolved) {
					return json({ error: "Output not found." }, { status: 404 });
				}
				return new Response(await readFile(resolved.filePath), {
					status: 200,
					headers: {
						"content-type": resolved.contentType,
						"cache-control": "no-store",
						"access-control-allow-origin": "*",
					},
				});
			}

			return json({ error: "Not found." }, { status: 404 });
		},
	};
}

export async function handleNodeRequest(
	handler: (request: Request) => Promise<Response>,
	input: {
		url: string;
		method: string;
		headers: IncomingHttpHeaders;
		body?: Uint8Array;
	},
): Promise<Response> {
	const body =
		input.body && input.body.byteLength > 0
			? Buffer.from(input.body)
			: undefined;

	const request = new Request(input.url, {
		method: input.method,
		headers: normalizeHeaders(input.headers),
		body,
	});

	return handler(request);
}

async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		return {} as T;
	}
}

function json(payload: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	headers.set("access-control-allow-origin", "*");
	headers.set("access-control-allow-headers", "content-type");
	headers.set("access-control-allow-methods", "GET,POST,OPTIONS,DELETE");
	return new Response(JSON.stringify(payload), {
		...init,
		headers,
	});
}

function toPublicJob(job: JobRecord): PublicJobRecord {
	return {
		id: job.id,
		sessionKey: job.sessionKey,
		provider: job.provider,
		chunk: job.chunk,
		category: job.category,
		model: job.model,
		sequence: job.sequence,
		status: job.status,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
		stage: job.stage,
		thinking: job.thinking,
		stageLog: job.stageLog,
		resultMode: job.resultMode,
		streamText: job.streamText,
		outputText: job.outputText,
		preview: job.preview,
		error: job.error,
	};
}

function isProviderId(value: string): value is QueueEnqueueInput["provider"] {
	return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

function normalizeHeaders(headers: IncomingHttpHeaders): Headers {
	const normalized = new Headers();

	for (const [key, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				normalized.append(key, item);
			}
			continue;
		}

		if (typeof value === "string") {
			normalized.set(key, value);
		}
	}

	return normalized;
}

function appendStageLog(
	existing: BuilderStageLogEntry[],
	stage: BuilderStage,
	message: string,
): BuilderStageLogEntry[] {
	if (existing.some((entry) => entry.stage === stage && entry.message === message)) {
		return existing;
	}

	return [
		...existing,
		{
			stage,
			message,
			at: new Date().toISOString(),
		},
	];
}

function previewsMatch(
	left: PreviewDocument | undefined,
	right: PreviewDocument | undefined,
): boolean {
	const leftFiles = previewToBuilderFiles(left);
	const rightFiles = previewToBuilderFiles(right);

	return Object.entries(leftFiles).every(
		([path, content]) => rightFiles[path] === content,
	);
}
