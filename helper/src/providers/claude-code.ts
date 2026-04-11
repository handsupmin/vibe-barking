import { spawn } from "node:child_process";

import { normalizePreviewDocument } from "../preview/normalize-preview.ts";
import { buildClaudeCodeCommand } from "../security/claude-code-command-policy.ts";
import type {
	ProviderGenerationRequest,
	ProviderGenerationResult,
	ProviderValidationResult,
} from "../types.ts";
import type { ProviderAdapter } from "./provider.ts";

interface ClaudeCodeProviderOptions {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
}

export function createClaudeCodeProvider({
	env = process.env,
	cwd = process.cwd(),
}: ClaudeCodeProviderOptions = {}): ProviderAdapter {
	const displayName = "Claude Code CLI";

	return {
		id: "claude-code",
		displayName,
		configSummary() {
			const command = env.CLAUDE_CODE_CLI_PATH ?? env.CLAUDE_CODE_BIN;
			return {
				provider: "claude-code",
				displayName,
				configured: typeof command === "string" && isSafeClaudePath(command),
				missing: command ? [] : ["CLAUDE_CODE_CLI_PATH or CLAUDE_CODE_BIN"],
				requiresCli: true,
				envVars: [
					"CLAUDE_CODE_CLI_PATH",
					"CLAUDE_CODE_BIN",
					"CLAUDE_CODE_MODEL",
				],
				details: {
					command: command ?? null,
				},
			};
		},
		async validate(input) {
			return validateClaudeCode({
				env,
				cwd,
				model: input?.model,
				command: input?.command,
			});
		},
		async generate(request) {
			return generateClaudeCode({ env, cwd, request });
		},
	};
}

async function validateClaudeCode({
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
		const outputText = await runClaudeCodePrompt({
			prompt: "Reply with READY and nothing else.",
			cwd,
			claudePath:
				command?.trim() || env.CLAUDE_CODE_CLI_PATH || env.CLAUDE_CODE_BIN,
			model: model ?? env.CLAUDE_CODE_MODEL,
		});

		return {
			ok: /ready/i.test(outputText),
			provider: "claude-code",
			model: model ?? env.CLAUDE_CODE_MODEL,
			message: /ready/i.test(outputText)
				? "Claude Code CLI responded successfully."
				: "Claude Code CLI ran, but validation text was unexpected.",
		};
	} catch (error) {
		return {
			ok: false,
			provider: "claude-code",
			model: model ?? env.CLAUDE_CODE_MODEL,
			message:
				error instanceof Error
					? error.message
					: "Claude Code CLI validation failed.",
		};
	}
}

async function generateClaudeCode({
	env,
	cwd,
	request,
}: {
	env: NodeJS.ProcessEnv;
	cwd: string;
	request: ProviderGenerationRequest;
}): Promise<ProviderGenerationResult> {
	const outputText = await runClaudeCodePrompt({
		prompt: `${request.prompt.system}\n\n${request.prompt.user}`,
		cwd,
		claudePath: env.CLAUDE_CODE_CLI_PATH ?? env.CLAUDE_CODE_BIN,
		model: request.model ?? env.CLAUDE_CODE_MODEL,
	});

	return {
		outputText,
		preview: normalizePreviewDocument(outputText),
	};
}

async function runClaudeCodePrompt({
	prompt,
	cwd,
	claudePath,
	model,
}: {
	prompt: string;
	cwd: string;
	claudePath?: string;
	model?: string;
}): Promise<string> {
	const { command, args } = buildClaudeCodeCommand({
		claudePath: claudePath ?? "claude",
		model,
		prompt,
	});

	const result = await new Promise<{
		code: number | null;
		stdout: string;
		stderr: string;
	}>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});

	if (result.code !== 0) {
		throw new Error(
			result.stderr.trim() ||
				`Claude Code CLI exited with code ${result.code}.`,
		);
	}

	const outputText = result.stdout.trim();
	if (!outputText) {
		throw new Error("Claude Code CLI returned an empty response.");
	}

	return outputText;
}

function isSafeClaudePath(value: string): boolean {
	try {
		buildClaudeCodeCommand({
			claudePath: value,
			prompt: "READY",
		});
		return true;
	} catch {
		return false;
	}
}
