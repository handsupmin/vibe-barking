import { assertSafeExecutablePath } from "./executable-path.ts";

export interface CodexCommand {
	command: string;
	args: string[];
}

interface BuildCodexCommandInput {
	codexPath?: string;
	model?: string;
	outputFile?: string;
}

export function buildCodexCommand({
	codexPath = "codex",
	model,
	outputFile = "__CODEX_OUTPUT__",
}: BuildCodexCommandInput = {}): CodexCommand {
	assertSafeExecutablePath(codexPath, "codex executable path");

	const args = [
		"exec",
		"--skip-git-repo-check",
		"--sandbox",
		"read-only",
		"--output-last-message",
		outputFile,
	];

	if (model) {
		args.push("-m", model);
	}

	args.push("-");

	return {
		command: codexPath,
		args,
	};
}
