import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createClaudeCodeProvider } from "../src/providers/claude-code.ts";

test("claude-code validate passes helper-loaded env through to the spawned CLI", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-claude-env-"));
	const scriptPath = join(cwd, "fake-claude");

	await writeFile(
		scriptPath,
		`#!/bin/sh
if [ "$ANTHROPIC_API_KEY" = "test-key" ]; then
  echo "READY"
  exit 0
fi
echo "missing key"
exit 1
`,
		"utf8",
	);
	await chmod(scriptPath, 0o755);

	const provider = createClaudeCodeProvider({
		cwd,
		env: {
			CLAUDE_CODE_CLI_PATH: scriptPath,
			ANTHROPIC_API_KEY: "test-key",
		},
	});

	const result = await provider.validate({});

	assert.equal(result.ok, true);
	assert.match(result.message, /responded successfully/i);
});
