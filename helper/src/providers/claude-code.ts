import { spawn } from "node:child_process";

import { materializePreviewResult } from "../preview/builder-preview.ts";
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
			timeoutMs: Number(
				env.CLAUDE_CODE_VALIDATE_TIMEOUT_MS ?? env.CLAUDE_CODE_TIMEOUT_MS ?? "15000",
			),
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
		timeoutMs: Number(
			env.CLAUDE_CODE_TIMEOUT_MS ?? env.CLAUDE_CODE_VALIDATE_TIMEOUT_MS ?? "45000",
		),
		onProgressDelta: request.onProgressDelta,
	});

	const resolved = materializePreviewResult(outputText, request.currentPreview);
	return {
		outputText,
		preview: resolved.preview,
		envelope: resolved.envelope,
		resultMode: resolved.resultMode,
	};
}

async function runClaudeCodePrompt({
	prompt,
	cwd,
	claudePath,
	model,
	timeoutMs,
	onProgressDelta,
}: {
	prompt: string;
	cwd: string;
	claudePath?: string;
	model?: string;
	timeoutMs: number;
	onProgressDelta?: (delta: string) => void;
}): Promise<string> {
	const { command, args } = buildClaudeCodeCommand({
		claudePath: claudePath ?? "claude",
		model,
		prompt,
		outputFormat: onProgressDelta ? "stream-json" : "text",
		includePartialMessages: Boolean(onProgressDelta),
		verbose: Boolean(onProgressDelta),
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
		let streamBuffer = "";
		let lastResult = "";
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
					`Claude Code CLI timed out after ${timeoutMs}ms while validating or generating this bark chunk.`,
				),
			);
		}, timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (!onProgressDelta) {
				return;
			}
			streamBuffer += chunk;
			const lines = streamBuffer.split(/\r?\n/);
			streamBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) {
					continue;
				}
				try {
					const event = JSON.parse(trimmed) as Record<string, unknown>;
					const topType = typeof event.type === 'string' ? event.type : undefined;
					if (topType === 'stream_event') {
						const inner = typeof event.event === 'object' && event.event !== null ? event.event as Record<string, unknown> : null;
						if (inner?.type === 'content_block_delta') {
							const delta = typeof inner.delta === 'object' && inner.delta !== null ? inner.delta as Record<string, unknown> : null;
							const text = typeof delta?.text === 'string' ? delta.text : typeof delta?.text_delta === 'string' ? delta.text_delta : undefined;
							if (text) {
								onProgressDelta(text);
							}
						}
					}
					if (topType === 'result' && typeof event.result === 'string') {
						lastResult = event.result;
					}
					if (topType === 'assistant') {
						const message = typeof event.message === 'object' && event.message !== null ? event.message as Record<string, unknown> : null;
						const content = Array.isArray(message?.content) ? message.content : [];
						const textParts = content
							.map((item) => (typeof item === 'object' && item !== null ? item as Record<string, unknown> : null))
							.map((item) => (typeof item?.text === 'string' ? item.text : ''))
							.filter(Boolean);
						if (textParts.length > 0) {
							lastResult = textParts.join('');
						}
					}
				} catch {
					// ignore malformed lines and keep accumulating stdout
				}
			}
		});
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
			resolve({ code, stdout: onProgressDelta ? (lastResult || stdout) : stdout, stderr });
		});
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
