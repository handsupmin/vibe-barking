import { assertSafeExecutablePath } from "./executable-path.ts";

export interface ClaudeCodeCommand {
	command: string;
	args: string[];
}

interface BuildClaudeCodeCommandInput {
	claudePath?: string;
	model?: string;
	prompt: string;
	outputFormat?: "text" | "stream-json";
	includePartialMessages?: boolean;
	verbose?: boolean;
}

export function buildClaudeCodeCommand({
	claudePath = "claude",
	model,
	prompt,
	outputFormat = "text",
	includePartialMessages = false,
	verbose = false,
}: BuildClaudeCodeCommandInput): ClaudeCodeCommand {
	assertSafeExecutablePath(claudePath, "claude executable path");

	const args = ["-p", prompt];
	if (verbose) {
		args.push("--verbose");
	}
	if (outputFormat !== "text") {
		args.push("--output-format", outputFormat);
	}
	if (includePartialMessages) {
		args.push("--include-partial-messages");
	}
	if (model) {
		args.push("--model", model);
	}

	return {
		command: claudePath,
		args,
	};
}
