import { assertSafeExecutablePath } from "./executable-path.ts";

export interface ClaudeCodeCommand {
	command: string;
	args: string[];
}

interface BuildClaudeCodeCommandInput {
	claudePath?: string;
	model?: string;
	prompt: string;
}

export function buildClaudeCodeCommand({
	claudePath = "claude",
	model,
	prompt,
}: BuildClaudeCodeCommandInput): ClaudeCodeCommand {
	assertSafeExecutablePath(claudePath, "claude executable path");

	const args = ["-p", prompt];
	if (model) {
		args.push("--model", model);
	}

	return {
		command: claudePath,
		args,
	};
}
