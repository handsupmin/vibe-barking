import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizePreviewDocument } from "../preview/normalize-preview.ts";
import { buildCodexCommand } from "../security/codex-command-policy.ts";
import type {
	ProviderGenerationRequest,
	ProviderGenerationResult,
	ProviderValidationResult,
} from "../types.ts";
import type { ProviderAdapter } from "./provider.ts";

interface CodexCliProviderOptions {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
}

export function createCodexCliProvider({
	env = process.env,
	cwd = process.cwd(),
}: CodexCliProviderOptions = {}): ProviderAdapter {
	const displayName = "Codex CLI";

	return {
		id: "codex",
		displayName,
		configSummary() {
			return {
				provider: "codex",
				displayName,
				configured: isSafeCodexPath(env.CODEX_CLI_PATH ?? "codex"),
				missing: [],
				requiresCli: true,
				envVars: ["CODEX_CLI_PATH", "CODEX_MODEL"],
			};
		},
		async validate(input) {
			return validateCodex({ env, cwd, model: input?.model });
		},
		async generate(request) {
			return generateCodex({ env, cwd, request });
		},
	};
}

async function validateCodex({
	env,
	cwd,
	model,
}: {
	env: NodeJS.ProcessEnv;
	cwd: string;
	model?: string;
}): Promise<ProviderValidationResult> {
	try {
		const outputText = await runCodexPrompt({
			prompt: "Reply with READY and nothing else.",
			cwd,
			codexPath: env.CODEX_CLI_PATH,
			model: model ?? env.CODEX_MODEL,
		});

		return {
			ok: /ready/i.test(outputText),
			provider: "codex",
			model: model ?? env.CODEX_MODEL,
			message: /ready/i.test(outputText)
				? "Codex CLI responded successfully."
				: "Codex CLI ran, but validation text was unexpected.",
		};
	} catch (error) {
		return {
			ok: false,
			provider: "codex",
			model: model ?? env.CODEX_MODEL,
			message:
				error instanceof Error ? error.message : "Codex CLI validation failed.",
		};
	}
}

async function generateCodex({
	env,
	cwd,
	request,
}: {
	env: NodeJS.ProcessEnv;
	cwd: string;
	request: ProviderGenerationRequest;
}): Promise<ProviderGenerationResult> {
	const outputText = await runCodexPrompt({
		prompt: `${request.prompt.system}\n\n${request.prompt.user}`,
		cwd,
		codexPath: env.CODEX_CLI_PATH,
		model: request.model ?? env.CODEX_MODEL,
	});

	return {
		outputText,
		preview: normalizePreviewDocument(outputText),
	};
}

async function runCodexPrompt({
	prompt,
	cwd,
	codexPath,
	model,
}: {
	prompt: string;
	cwd: string;
	codexPath?: string;
	model?: string;
}): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), "vibe-barking-codex-"));
	const outputFile = join(tempDir, "last-message.txt");
	const { command, args } = buildCodexCommand({
		codexPath: codexPath ?? "codex",
		model,
		outputFile,
	});

	const result = await new Promise<{ code: number | null; stderr: string }>(
		(resolve, reject) => {
			const child = spawn(command, args, {
				cwd,
				stdio: ["pipe", "ignore", "pipe"],
			});

			let stderr = "";
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, stderr }));
			child.stdin.end(prompt);
		},
	);

	try {
		const outputText = (await readFile(outputFile, "utf8")).trim();
		if (result.code !== 0) {
			throw new Error(
				result.stderr.trim() || `Codex CLI exited with code ${result.code}.`,
			);
		}

		if (!outputText) {
			throw new Error("Codex CLI returned an empty response.");
		}

		return outputText;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

function isSafeCodexPath(value: string): boolean {
	try {
		buildCodexCommand({ codexPath: value });
		return true;
	} catch {
		return false;
	}
}
