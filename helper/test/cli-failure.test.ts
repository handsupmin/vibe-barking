import assert from "node:assert/strict";
import test from "node:test";

import { resolveCliFailureMessage } from "../src/providers/cli-failure.ts";

test("resolveCliFailureMessage surfaces stdout auth errors when stderr is empty", () => {
	const message = resolveCliFailureMessage({
		stderr: "",
		stdout: [
			'{"type":"system","subtype":"init"}',
			'{"type":"assistant","message":{"content":[{"type":"text","text":"Your organization does not have access to Claude. Please login again or contact your administrator."}]}}',
			'{"type":"result","result":"Your organization does not have access to Claude. Please login again or contact your administrator."}',
		].join("\n"),
		exitCode: 1,
		commandLabel: "Claude Code CLI",
	});

	assert.match(message, /does not have access to Claude/i);
});

test("resolveCliFailureMessage prefers stderr when it is present", () => {
	const message = resolveCliFailureMessage({
		stderr: "Permission denied",
		stdout: "ignored stdout",
		exitCode: 1,
		commandLabel: "Codex CLI",
	});

	assert.equal(message, "Permission denied");
});
