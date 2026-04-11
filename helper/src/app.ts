import type { IncomingHttpHeaders } from "node:http";
import { createProviders } from "./providers/index.ts";
import type { ProviderAdapter } from "./providers/provider.ts";
import { JobQueue } from "./queue/job-queue.ts";
import {
	type JobRecord,
	type PublicJobRecord,
	type QueueEnqueueInput,
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
	env = process.env,
	fetchFn = fetch,
	cwd = process.cwd(),
}: CreateAppOptions = {}) {
	const registry = providers ?? createProviders({ env, fetchFn, cwd });
	const providerMap = new Map(
		registry.map((provider) => [provider.id, provider]),
	);
	const jobQueue =
		queue ??
		new JobQueue({
			processJob: async (job) => {
				const provider = providerMap.get(job.provider);
				if (!provider) {
					throw new Error(`Unknown provider: ${job.provider}`);
				}

				return provider.generate({
					prompt: job.prompt,
					model: job.model,
				});
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

			if (
				request.method === "POST" &&
				url.pathname === "/api/providers/validate"
			) {
				const body = await readJson<{ provider?: string; model?: string }>(
					request,
				);
				if (!body.provider || !isProviderId(body.provider)) {
					return json({ error: "Unknown provider." }, { status: 400 });
				}

				const provider = providerMap.get(body.provider);
				if (!provider) {
					return json({ error: "Unknown provider." }, { status: 400 });
				}

				const result = await provider.validate({
					model: body.model,
				});
				return json(result, { status: result.ok ? 200 : 400 });
			}

			if (request.method === "POST" && url.pathname === "/api/jobs") {
				const body = await readJson<QueueEnqueueInput>(request);
				if (!body.provider || !isProviderId(body.provider)) {
					return json({ error: "Unknown provider." }, { status: 400 });
				}

				if (
					!body.chunk ||
					typeof body.chunk !== "string" ||
					body.chunk.trim().length === 0
				) {
					return json({ error: "Chunk is required." }, { status: 400 });
				}

				const job = jobQueue.enqueue({
					provider: body.provider,
					chunk: body.chunk,
					category: body.category,
					model: body.model,
				});

				return json({ job: toPublicJob(job) }, { status: 202 });
			}

			if (request.method === "GET" && url.pathname === "/api/jobs") {
				return json({ jobs: jobQueue.list().map(toPublicJob) });
			}

			if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
				const jobId = url.pathname.replace("/api/jobs/", "");
				const job = jobQueue.get(jobId);
				if (!job) {
					return json({ error: "Job not found." }, { status: 404 });
				}

				return json({ job: toPublicJob(job) });
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
	const request = new Request(input.url, {
		method: input.method,
		headers: normalizeHeaders(input.headers),
		body: input.body && input.body.byteLength > 0 ? input.body : undefined,
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
	headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
	return new Response(JSON.stringify(payload), {
		...init,
		headers,
	});
}

function toPublicJob(job: JobRecord): PublicJobRecord {
	return {
		id: job.id,
		provider: job.provider,
		chunk: job.chunk,
		category: job.category,
		model: job.model,
		sequence: job.sequence,
		status: job.status,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
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
