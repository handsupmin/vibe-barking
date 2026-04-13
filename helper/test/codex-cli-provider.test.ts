import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexCliProvider } from "../src/providers/codex-cli.ts";

test("codex validate surfaces stdout-only auth failures when no output file is produced", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-codex-auth-"));
	const scriptPath = join(cwd, "fake-codex");

	await writeFile(
		scriptPath,
		`#!/bin/sh
echo "Please login again to Codex CLI."
exit 1
`,
		"utf8",
	);
	await chmod(scriptPath, 0o755);

	const provider = createCodexCliProvider({
		cwd,
		env: {
			CODEX_CLI_PATH: scriptPath,
		},
	});

	const result = await provider.validate({});

	assert.equal(result.ok, false);
	assert.match(result.message, /please login again to codex cli/i);
});
