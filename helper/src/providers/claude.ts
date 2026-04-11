import { normalizePreviewDocument } from "../preview/normalize-preview.ts";
import type {
	ProviderGenerationRequest,
	ProviderGenerationResult,
	ProviderValidationResult,
} from "../types.ts";
import type { ProviderAdapter } from "./provider.ts";

interface ClaudeProviderOptions {
	env?: NodeJS.ProcessEnv;
	fetchFn?: typeof fetch;
}

export function createClaudeProvider({
	env = process.env,
	fetchFn = fetch,
}: ClaudeProviderOptions = {}): ProviderAdapter {
	const displayName = "Claude";

	return {
		id: "claude",
		displayName,
		configSummary() {
			const missing = requiredEnv(env, ["ANTHROPIC_API_KEY"]);
			return {
				provider: "claude",
				displayName,
				configured: missing.length === 0,
				missing,
				requiresCli: false,
				envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
			};
			},
			async validate(input) {
				return validateClaude({
					env,
					fetchFn,
					model: input?.model,
					secret: input?.secret,
				});
			},
		async generate(request) {
			return generateClaude({ env, fetchFn, request });
		},
	};
}

async function validateClaude({
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
	const effectiveModel = model ?? env.ANTHROPIC_MODEL;
	const apiKey = secret?.trim() || env.ANTHROPIC_API_KEY;
	const missing = requiredEnv({ ...env, ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: effectiveModel }, [
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_MODEL",
	]);
	if (missing.length > 0) {
		return {
			ok: false,
			provider: "claude",
			model: effectiveModel,
			message: `Missing ${missing.join(", ")}`,
		};
	}

	if (!apiKey || !effectiveModel) {
		return {
			ok: false,
			provider: "claude",
			model: effectiveModel,
			message: "Claude is not configured.",
		};
	}

	try {
		const response = await fetchClaude(fetchFn, apiKey, effectiveModel, {
			system: "Reply with READY and nothing else.",
			user: "READY",
		});
		const payload = await response.json();

		if (!response.ok) {
			return {
				ok: false,
				provider: "claude",
				model: effectiveModel,
				message: `Claude validation failed: ${extractErrorMessage(payload)}`,
			};
		}

		return {
			ok: true,
			provider: "claude",
			model: effectiveModel,
			message: "Claude responded successfully.",
		};
	} catch (error) {
		return {
			ok: false,
			provider: "claude",
			model: effectiveModel,
			message:
				error instanceof Error ? error.message : "Claude validation failed.",
		};
	}
}

async function generateClaude({
	env,
	fetchFn,
	request,
}: {
	env: NodeJS.ProcessEnv;
	fetchFn: typeof fetch;
	request: ProviderGenerationRequest;
}): Promise<ProviderGenerationResult> {
	const effectiveModel = request.model ?? env.ANTHROPIC_MODEL;
	const missing = requiredEnv({ ...env, ANTHROPIC_MODEL: effectiveModel }, [
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_MODEL",
	]);
	if (missing.length > 0) {
		throw new Error(`Missing ${missing.join(", ")}`);
	}

	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey || !effectiveModel) {
		throw new Error("Claude is not configured.");
	}

	const response = await fetchClaude(fetchFn, apiKey, effectiveModel, {
		system: request.prompt.system,
		user: request.prompt.user,
	});
	const payload = await response.json();
	if (!response.ok) {
		throw new Error(`Claude generate failed: ${extractErrorMessage(payload)}`);
	}

	const outputText = extractClaudeText(payload);
	return {
		outputText,
		preview: normalizePreviewDocument(outputText),
	};
}

function fetchClaude(
	fetchFn: typeof fetch,
	apiKey: string,
	model: string,
	prompt: { system: string; user: string },
): Promise<Response> {
	return fetchFn("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model,
			max_tokens: 1200,
			system: prompt.system,
			messages: [{ role: "user", content: prompt.user }],
		}),
	});
}

function extractClaudeText(payload: unknown): string {
	const root = asRecord(payload);
	const content = Array.isArray(root?.content) ? root.content : [];
	const text = content
		.map((item) => readString(asRecord(item), "text"))
		.filter((value): value is string => Boolean(value))
		.join("\n");

	if (typeof text === "string" && text.trim()) {
		return text.trim();
	}

	throw new Error("Claude did not return text output.");
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
