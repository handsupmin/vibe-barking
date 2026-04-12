import { materializePreviewResult } from "../preview/builder-preview.ts";
import type {
	ProviderGenerationRequest,
	ProviderGenerationResult,
	ProviderValidationResult,
} from "../types.ts";
import type { ProviderAdapter } from "./provider.ts";

interface GeminiProviderOptions {
	env?: NodeJS.ProcessEnv;
	fetchFn?: typeof fetch;
}

const GEMINI_BUILDER_RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		stage: {
			type: "string",
			enum: ["ciphertext_interpreting", "working", "applying", "applied"],
			description: "Current builder phase for the live progress rail.",
		},
		thinking: {
			type: "array",
			description: "Short user-visible worklog strings.",
			items: {
				type: "string",
			},
		},
		result: {
			type: "object",
			description: "Prefer a patch result. Snapshot is only for fallback.",
			properties: {
				mode: {
					type: "string",
					enum: ["patch", "snapshot"],
				},
				operations: {
					type: "array",
					items: {
						type: "object",
						properties: {
							type: { type: "string", enum: ["replace_file"] },
							path: { type: "string" },
							content: { type: "string" },
						},
						required: ["type", "path", "content"],
					},
				},
				snapshot: {
					type: ["object", "null"],
					properties: {
						title: { type: "string" },
						summary: { type: "string" },
						html: { type: "string" },
						css: { type: "string" },
						javascript: { type: "string" },
					},
					required: ["title", "summary", "html", "css", "javascript"],
				},
			},
			required: ["mode"],
		},
	},
	required: ["stage", "thinking", "result"],
} as const;

export function createGeminiProvider({
	env = process.env,
	fetchFn = fetch,
}: GeminiProviderOptions = {}): ProviderAdapter {
	const displayName = "Gemini";

	return {
		id: "gemini",
		displayName,
		configSummary() {
			const missing = requiredGeminiEnv(
				env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
				env.GEMINI_MODEL,
			);
			return {
				provider: "gemini",
				displayName,
				configured: missing.length === 0,
				missing,
				requiresCli: false,
				envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL"],
			};
		},
		async validate(input) {
			return validateGemini({
				env,
				fetchFn,
				model: input?.model,
				secret: input?.secret,
			});
		},
		async generate(request) {
			return generateGemini({ env, fetchFn, request });
		},
	};
}

async function validateGemini({
	env,
	fetchFn,
	model,
	secret,
}: {
	env: NodeJS.ProcessEnv;
	fetchFn: typeof fetch;
	model?: string;
	secret?: string;
}): Promise<ProviderValidationResult> {
	const effectiveModel = model ?? env.GEMINI_MODEL;
	const apiKey = secret?.trim() || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
	const missing = requiredGeminiEnv(apiKey, effectiveModel);
	if (missing.length > 0) {
		return {
			ok: false,
			provider: "gemini",
			model: effectiveModel,
			message: `Missing ${missing.join(", ")}`,
		};
	}

	if (!apiKey || !effectiveModel) {
		return {
			ok: false,
			provider: "gemini",
			model: effectiveModel,
			message: "Gemini is not configured.",
		};
	}

	try {
		const response = await fetchGemini(
			fetchFn,
			apiKey,
			effectiveModel,
			"Reply with READY and nothing else.",
			false,
		);
		if (!response.ok) {
			const payload = await response.json();
			return {
				ok: false,
				provider: "gemini",
				model: effectiveModel,
				message: `Gemini validation failed: ${extractErrorMessage(payload)}`,
			};
		}

		return {
			ok: true,
			provider: "gemini",
			model: effectiveModel,
			message: "Gemini responded successfully.",
		};
	} catch (error) {
		return {
			ok: false,
			provider: "gemini",
			model: effectiveModel,
			message:
				error instanceof Error ? error.message : "Gemini validation failed.",
		};
	}
}

async function generateGemini({
	env,
	fetchFn,
	request,
}: {
	env: NodeJS.ProcessEnv;
	fetchFn: typeof fetch;
	request: ProviderGenerationRequest;
}): Promise<ProviderGenerationResult> {
	const effectiveModel = request.model ?? env.GEMINI_MODEL;
	const missing = requiredGeminiEnv(
		env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
		effectiveModel,
	);
	if (missing.length > 0) {
		throw new Error(`Missing ${missing.join(", ")}`);
	}

	const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
	if (!apiKey || !effectiveModel) {
		throw new Error("Gemini is not configured.");
	}

	const prompt = `${request.prompt.system}\n\n${request.prompt.user}`;
	const outputText = request.onProgressDelta
		? await generateGeminiStream({
				fetchFn,
				apiKey,
				model: effectiveModel,
				prompt,
				onProgressDelta: request.onProgressDelta,
			})
		: await generateGeminiStandard({
				fetchFn,
				apiKey,
				model: effectiveModel,
				prompt,
			});

	const resolved = materializePreviewResult(outputText, request.currentPreview);
	return {
		outputText,
		preview: resolved.preview,
		envelope: resolved.envelope,
		resultMode: resolved.resultMode,
	};
}

async function generateGeminiStandard({
	fetchFn,
	apiKey,
	model,
	prompt,
}: {
	fetchFn: typeof fetch;
	apiKey: string;
	model: string;
	prompt: string;
}): Promise<string> {
	const response = await fetchGemini(fetchFn, apiKey, model, prompt, true);
	const payload = await response.json();

	if (!response.ok) {
		throw new Error(`Gemini generate failed: ${extractErrorMessage(payload)}`);
	}

	return extractGeminiText(payload);
}

async function generateGeminiStream({
	fetchFn,
	apiKey,
	model,
	prompt,
	onProgressDelta,
}: {
	fetchFn: typeof fetch;
	apiKey: string;
	model: string;
	prompt: string;
	onProgressDelta: (delta: string) => void;
}): Promise<string> {
	const response = await fetchGeminiStream(fetchFn, apiKey, model, prompt);
	if (!response.ok) {
		const payload = await readGeminiErrorPayload(response);
		throw new Error(`Gemini generate failed: ${extractErrorMessage(payload)}`);
	}

	if (!response.body) {
		throw new Error("Gemini streaming response body was missing.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let outputText = "";

	while (true) {
		const { done, value } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		const result = consumeSseBuffer(buffer, done);
		buffer = result.remainder;
		for (const delta of result.deltas) {
			if (!delta) {
				continue;
			}
			outputText += delta;
			onProgressDelta(delta);
		}
		if (done) {
			break;
		}
	}

	const normalized = outputText.trim();
	if (!normalized) {
		throw new Error("Gemini streaming call returned no text output.");
	}

	return normalized;
}

function fetchGemini(
	fetchFn: typeof fetch,
	apiKey: string,
	model: string,
	prompt: string,
	structured: boolean,
): Promise<Response> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
	return fetchFn(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify(buildGeminiBody(prompt, structured)),
	});
}

function fetchGeminiStream(
	fetchFn: typeof fetch,
	apiKey: string,
	model: string,
	prompt: string,
): Promise<Response> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
	return fetchFn(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify(buildGeminiBody(prompt, true)),
	});
}

function buildGeminiBody(prompt: string, structured: boolean): Record<string, unknown> {
	return {
		contents: [
			{
				role: "user",
				parts: [{ text: prompt }],
			},
		],
		...(structured
			? {
				generationConfig: {
					responseMimeType: "application/json",
					responseJsonSchema: GEMINI_BUILDER_RESPONSE_SCHEMA,
				},
			}
			: {}),
	};
}

function consumeSseBuffer(
	buffer: string,
	flush: boolean,
): { deltas: string[]; remainder: string } {
	const normalized = buffer.replaceAll("\r\n", "\n");
	const blocks = normalized.split("\n\n");
	const remainder = flush ? "" : blocks.pop() ?? "";
	const deltas: string[] = [];

	for (const block of blocks) {
		const payload = parseSseBlock(block);
		if (!payload) {
			continue;
		}
		const delta = extractGeminiText(payload, { trim: false });
		if (delta) {
			deltas.push(delta);
		}
	}

	return { deltas, remainder };
}

function parseSseBlock(block: string): unknown {
	const dataLines = block
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter(Boolean);

	if (dataLines.length === 0) {
		return null;
	}

	const joined = dataLines.join("\n");
	if (joined === "[DONE]") {
		return null;
	}

	try {
		return JSON.parse(joined);
	} catch {
		return null;
	}
}

async function readGeminiErrorPayload(response: Response): Promise<unknown> {
	const raw = await response.text();
	if (!raw.trim()) {
		return raw;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function extractGeminiText(
	payload: unknown,
	options: { trim?: boolean } = {},
): string {
	const root = asRecord(payload);
	const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
	const firstCandidate = asRecord(candidates[0]);
	const content = asRecord(firstCandidate?.content);
	const parts = Array.isArray(content?.parts) ? content.parts : [];

	const text = parts
		.map((part) => readString(asRecord(part), "text"))
		.filter((value): value is string => Boolean(value))
		.join("\n");

	if (typeof text === "string" && text.length > 0) {
		return options.trim === false ? text : text.trim();
	}

	throw new Error("Gemini did not return text output.");
}

function extractErrorMessage(payload: unknown): string {
	const root = asRecord(payload);
	const errorRecord = asRecord(root?.error);
	if (typeof payload === "string" && payload.trim()) {
		return payload.trim();
	}
	return (
		readString(errorRecord, "message") ??
		readString(root, "message") ??
		"Unknown error"
	);
}

function requiredGeminiEnv(
	apiKey: string | undefined,
	effectiveModel?: string,
): string[] {
	const missing: string[] = [];

	if (!apiKey) {
		missing.push("GEMINI_API_KEY or GOOGLE_API_KEY");
	}

	if (!effectiveModel) {
		missing.push("GEMINI_MODEL");
	}

	return missing;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function readString(
	record: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}
