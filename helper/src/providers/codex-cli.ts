import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializePreviewResult } from "../preview/builder-preview.ts";
import { buildCodexCommand } from "../security/codex-command-policy.ts";
import { resolveCliFailureMessage } from "./cli-failure.ts";
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

const DEFAULT_CODEX_VALIDATE_TIMEOUT_MS = 60_000;
const DEFAULT_CODEX_GENERATE_TIMEOUT_MS = 180_000;

export function createCodexCliProvider({
	env = process.env,
	cwd = process.cwd(),
}: CodexCliProviderOptions = {}): ProviderAdapter {
	const displayName = "Codex CLI";

	return {
		id: "codex",
		displayName,
		configSummary() {
			const command = env.CODEX_CLI_PATH ?? env.CODEX_BIN;
			return {
				provider: "codex",
				displayName,
				configured: typeof command === "string" && isSafeCodexPath(command),
				missing: command ? [] : ["CODEX_CLI_PATH or CODEX_BIN"],
				requiresCli: true,
				envVars: ["CODEX_CLI_PATH", "CODEX_BIN", "CODEX_MODEL"],
				details: {
					command: command ?? null,
				},
			};
		},
		async validate(input) {
			return validateCodex({
				env,
				cwd,
				model: input?.model,
				command: input?.command,
			});
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
	command,
}: {
	env: NodeJS.ProcessEnv;
	cwd: string;
	model?: string;
	command?: string;
}): Promise<ProviderValidationResult> {
	try {
		const outputText = await runCodexPrompt({
			prompt: "Reply with READY and nothing else.",
			cwd,
			codexPath: command?.trim() || env.CODEX_CLI_PATH || env.CODEX_BIN,
			model: model ?? env.CODEX_MODEL,
			timeoutMs: Number(
				env.CODEX_VALIDATE_TIMEOUT_MS ?? DEFAULT_CODEX_VALIDATE_TIMEOUT_MS,
			),
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
	const subagentDirective = [
		"<SUBAGENT-STOP>",
		"You are dispatched as a bounded subagent for one artifact-generation task.",
		"Do not use skills, MCP tools, shell commands, browser tools, file reads, or repository inspection.",
		"Do not ask clarifying questions.",
		"Return exactly one final answer and nothing else.",
		"</SUBAGENT-STOP>",
		"Return strict JSON only with keys: stage, thinking, result.",
		"Prefer a patch result with replace_file operations for src/meta.json, src/index.html, src/styles.css, and src/app.js.",
		"Only use snapshot fallback when patch mode is impossible.",
		"Do not include markdown fences or any explanatory prose.",
	].join("\n");

	const outputText = await runCodexPrompt({
		prompt: `${subagentDirective}\n\n${request.prompt.system}\n\n${request.prompt.user}`,
		cwd: request.sessionOutputDir ?? cwd,
		codexPath: env.CODEX_CLI_PATH ?? env.CODEX_BIN,
		model: request.model ?? env.CODEX_MODEL,
		timeoutMs: Number(env.CODEX_TIMEOUT_MS ?? DEFAULT_CODEX_GENERATE_TIMEOUT_MS),
	});

	const resolved = materializePreviewResult(outputText, request.currentPreview);
	return {
		outputText,
		preview: resolved.preview,
		envelope: resolved.envelope,
		resultMode: resolved.resultMode,
	};
}

async function runCodexPrompt({
	prompt,
	cwd,
	codexPath,
	model,
	timeoutMs,
}: {
	prompt: string;
	cwd: string;
	codexPath?: string;
	model?: string;
	timeoutMs: number;
}): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), "vibe-barking-codex-"));
	const outputFile = join(tempDir, "last-message.txt");
	const { command, args } = buildCodexCommand({
		codexPath: codexPath ?? "codex",
		model,
		outputFile,
	});

	const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
		(resolve, reject) => {
			const child = spawn(command, args, {
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			let settled = false;
			const timeoutId = setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				child.kill("SIGTERM");
				setTimeout(() => {
					if (!child.killed) {
						child.kill("SIGKILL");
					}
				}, 1000).unref();
				reject(
					new Error(
						`Codex CLI timed out after ${timeoutMs}ms.`,
					),
				);
			}, timeoutMs);

			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.on("error", (error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeoutId);
				reject(error);
			});
			child.on("close", (code) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeoutId);
				resolve({ code, stdout, stderr });
			});
			child.stdin.end(prompt);
		},
	);

	let outputText = "";
	try {
		try {
			outputText = (await readFile(outputFile, "utf8")).trim();
		} catch (error) {
			if (result.code === 0) {
				throw error;
			}
		}

		if (result.code !== 0) {
			throw new Error(
				resolveCliFailureMessage({
					stderr: result.stderr,
					stdout: result.stdout || outputText,
					exitCode: result.code,
					commandLabel: "Codex CLI",
				}),
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
