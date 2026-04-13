import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionOutputStore } from "../src/session-output/store.ts";

test("readPreview keeps the scaffold html as a builder fragment", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-session-store-"));
	const store = new SessionOutputStore({ cwd });

	await store.ensureSession("session-a");
	const preview = store.readPreview("session-a");

	assert.ok(preview);
	assert.match(preview.html, /<main class="shell">/i);
	assert.doesNotMatch(preview.html, /<html[\s>]/i);
});

test("writePreview round-trips raw builder files instead of a full html document", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-session-store-write-"));
	const store = new SessionOutputStore({ cwd });

	await store.writePreview("session-b", {
		title: "Neon Pulse Match",
		summary: "Tap the glowing tiles in order.",
		html: "<main><h1>Neon Pulse Match</h1><button>Start</button></main>",
		css: "body { background: black; }",
		javascript: 'document.body.dataset.mode = "play";',
	});

	const preview = store.readPreview("session-b");
	assert.ok(preview);
	assert.equal(
		preview.html,
		"<main><h1>Neon Pulse Match</h1><button>Start</button></main>",
	);
	assert.equal(preview.css, "body { background: black; }");
	assert.equal(preview.javascript, 'document.body.dataset.mode = "play";');
});
