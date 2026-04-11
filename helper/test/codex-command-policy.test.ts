import assert from "node:assert/strict";
import test from "node:test";

import { buildCodexCommand } from "../src/security/codex-command-policy.ts";

test("buildCodexCommand returns a fixed safe codex exec invocation", () => {
	const command = buildCodexCommand({ codexPath: "codex", model: "gpt-5.4" });

	assert.equal(command.command, "codex");
	assert.deepEqual(command.args.slice(0, 5), [
		"exec",
		"--skip-git-repo-check",
		"--sandbox",
		"read-only",
		"--output-last-message",
	]);
	assert.ok(command.args.includes("-m"));
	assert.ok(command.args.includes("gpt-5.4"));
});

test("buildCodexCommand rejects unsafe executable strings", () => {
	assert.throws(
		() => buildCodexCommand({ codexPath: "codex; rm -rf /" }),
		/unsafe/i,
	);
});
