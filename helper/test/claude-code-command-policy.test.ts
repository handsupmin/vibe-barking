import assert from "node:assert/strict";
import test from "node:test";

import { buildClaudeCodeCommand } from "../src/security/claude-code-command-policy.ts";

test("buildClaudeCodeCommand returns a fixed safe claude invocation", () => {
	const command = buildClaudeCodeCommand({
		claudePath: "claude",
		model: "sonnet",
		prompt: "READY",
	});

	assert.equal(command.command, "claude");
	assert.deepEqual(command.args, ["-p", "READY", "--model", "sonnet"]);
});

test("buildClaudeCodeCommand rejects unsafe executable strings", () => {
	assert.throws(
		() =>
			buildClaudeCodeCommand({
				claudePath: "claude; rm -rf /",
				prompt: "READY",
			}),
		/unsafe/i,
	);
});
