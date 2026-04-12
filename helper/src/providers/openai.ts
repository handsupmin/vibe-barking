import { materializePreviewResult } from "../preview/builder-preview.ts";
import type {
	ProviderGenerationRequest,
	ProviderGenerationResult,
	ProviderValidationResult,
} from "../types.ts";
import type { ProviderAdapter } from "./provider.ts";

interface OpenAIProviderOptions {
	env?: NodeJS.ProcessEnv;
	fetchFn?: typeof fetch;
}

export function createOpenAIProvider({
	env = process.env,
	fetchFn = fetch,
}: OpenAIProviderOptions = {}): ProviderAdapter {
	const displayName = "OpenAI";

		return {
		id: "openai",
		displayName,
		configSummary() {
			const missing = requiredEnv(env, ["OPENAI_API_KEY"]);
			return {
				provider: "openai",
				displayName,
				configured: missing.length === 0,
				missing,
				requiresCli: false,
				envVars: ["OPENAI_API_KEY", "OPENAI_MODEL"],
			};
		},
			async validate(input) {
				return validateOpenAI({
					env,
					fetchFn,
					model: input?.model,
					secret: input?.secret,
				});
			},
		async generate(request) {
			return generateOpenAI({ env, fetchFn, request });
		},
	};
}

async function validateOpenAI({
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
	const effectiveModel = model ?? env.OPENAI_MODEL;
	const apiKey = secret?.trim() || env.OPENAI_API_KEY;
	const missing = requiredEnv({ ...env, OPENAI_API_KEY: apiKey, OPENAI_MODEL: effectiveModel }, [
		"OPENAI_API_KEY",
		"OPENAI_MODEL",
	]);
	if (missing.length > 0) {
		return {
			ok: false,
			provider: "openai",
			model: effectiveModel,
			message: `Missing ${missing.join(", ")}`,
		};
	}

	if (!apiKey || !effectiveModel) {
		return {
			ok: false,
			provider: "openai",
			model: effectiveModel,
			message: "OpenAI is not configured.",
		};
	}

	try {
		const response = await fetchFn("https://api.openai.com/v1/responses", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: effectiveModel,
				input: "Reply with READY and nothing else.",
			}),
		});

		const payload = await response.json();
		if (!response.ok) {
			return {
				ok: false,
				provider: "openai",
				model: effectiveModel,
				message: `OpenAI validation failed: ${extractErrorMessage(payload)}`,
			};
		}

		return {
			ok: true,
			provider: "openai",
			model: effectiveModel,
			message: "OpenAI responded successfully.",
		};
	} catch (error) {
		return {
			ok: false,
			provider: "openai",
			model: effectiveModel,
			message:
				error instanceof Error ? error.message : "OpenAI validation failed.",
		};
	}
}

async function generateOpenAI({
	env,
	fetchFn,
	request,
}: {
	env: NodeJS.ProcessEnv;
	fetchFn: typeof fetch;
	request: ProviderGenerationRequest;
}): Promise<ProviderGenerationResult> {
	const effectiveModel = request.model ?? env.OPENAI_MODEL;
	const missing = requiredEnv({ ...env, OPENAI_MODEL: effectiveModel }, [
		"OPENAI_API_KEY",
		"OPENAI_MODEL",
	]);
	if (missing.length > 0) {
		throw new Error(`Missing ${missing.join(", ")}`);
	}

	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey || !effectiveModel) {
		throw new Error("OpenAI is not configured.");
	}

	const response = await fetchFn("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: effectiveModel,
			input: `${request.prompt.system}\n\n${request.prompt.user}`,
		}),
	});

	const payload = await response.json();
	if (!response.ok) {
		throw new Error(`OpenAI generate failed: ${extractErrorMessage(payload)}`);
	}

	const outputText = extractOpenAIText(payload);
	const resolved = materializePreviewResult(outputText, request.currentPreview);
	return {
		outputText,
		preview: resolved.preview,
		envelope: resolved.envelope,
		resultMode: resolved.resultMode,
	};
}

function extractOpenAIText(payload: unknown): string {
	const root = asRecord(payload);
	const outputText = readString(root, "output_text");
	if (outputText?.trim()) {
		return outputText.trim();
	}

	const output = Array.isArray(root?.output) ? root.output : [];
	const parts: string[] = [];
	for (const item of output) {
		const itemRecord = asRecord(item);
		const content = Array.isArray(itemRecord?.content)
			? itemRecord.content
			: [];
		for (const contentItem of content) {
			const text = readString(asRecord(contentItem), "text");
			if (text) {
				parts.push(text);
			}
		}
	}

	const joined = parts.join("\n").trim();
	if (joined) {
		return joined;
	}

	throw new Error("OpenAI did not return text output.");
}

function extractErrorMessage(payload: unknown): string {
	const root = asRecord(payload);
	const errorRecord = asRecord(root?.error);
	return (
		readString(errorRecord, "message") ??
		readString(root, "message") ??
		"Unknown error"
	);
}

function requiredEnv(env: NodeJS.ProcessEnv, keys: string[]): string[] {
	return keys.filter((key) => !env[key]);
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
