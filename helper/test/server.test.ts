import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../src/app.ts";
import { resolveHelperEnvFile } from "../src/config/env-store.ts";
import type { ProviderAdapter } from "../src/providers/provider.ts";

test("createApp exposes helper metadata without leaking secrets", async () => {
	const provider: ProviderAdapter = {
		id: "openai",
		displayName: "OpenAI",
		configSummary() {
			return {
				provider: "openai",
				displayName: "OpenAI",
				configured: true,
				missing: [],
				requiresCli: false,
				envVars: ["OPENAI_API_KEY", "OPENAI_MODEL"],
			};
		},
		async validate() {
			return { ok: true, provider: "openai", message: "ready" };
		},
		async generate() {
			return {
				outputText: "ok",
				preview: {
					title: "preview",
					summary: "summary",
					html: "<div>ok</div>",
					css: "",
					javascript: "",
				},
			};
		},
	};

	const app = createApp({ providers: [provider] });
	const response = await app.fetch(new Request("http://localhost/api/meta"));
	const body = await response.json();

	assert.equal(response.status, 200);
	assert.equal(body.providers[0].provider, "openai");
	assert.equal(body.providers[0].configured, true);
	assert.ok(!JSON.stringify(body).includes("OPENAI_API_KEY="));
	assert.deepEqual(body.categories, [
		"캐주얼게임",
		"아케이드 게임",
		"디펜스게임",
		"보드게임",
		"유틸리티",
		"3D게임(threejs)",
		"세상에 없는 엄청난 무언가",
	]);
});

test("provider validation accepts providerId and only persists after success", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-app-"));
	let validateCalls = 0;
	const provider: ProviderAdapter = {
		id: "openai",
		displayName: "OpenAI",
		configSummary() {
			return {
				provider: "openai",
				displayName: "OpenAI",
				configured: false,
				missing: ["OPENAI_API_KEY"],
				requiresCli: false,
				envVars: ["OPENAI_API_KEY", "OPENAI_MODEL"],
			};
		},
		async validate(input) {
			validateCalls += 1;
			return {
				ok: input?.secret === "good-key",
				provider: "openai",
				message:
					input?.secret === "good-key" ? "ready" : "bad credentials",
			};
		},
		async generate() {
			throw new Error("not used");
		},
	};

	const env: NodeJS.ProcessEnv = {};
	const app = createApp({ providers: [provider], cwd, env });

	const failed = await app.fetch(
		new Request("http://localhost/api/providers/validate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				providerId: "openai",
				secret: "bad-key",
				model: "gpt-5.4-mini",
			}),
		}),
	);

	assert.equal(failed.status, 400);
	await assert.rejects(() => readFile(resolveHelperEnvFile(cwd), "utf8"));

	const succeeded = await app.fetch(
		new Request("http://localhost/api/providers/validate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				providerId: "openai",
				secret: "good-key",
				model: "gpt-5.4-mini",
			}),
		}),
	);

	assert.equal(succeeded.status, 200);
	const saved = await readFile(resolveHelperEnvFile(cwd), "utf8");
	assert.match(saved, /OPENAI_API_KEY=good-key/);
	assert.equal(validateCalls, 2);
});

test("job enqueue accepts providerId contract from the frontend", async () => {
	const provider: ProviderAdapter = {
		id: "openai",
		displayName: "OpenAI",
		configSummary() {
			return {
				provider: "openai",
				displayName: "OpenAI",
				configured: true,
				missing: [],
				requiresCli: false,
				envVars: ["OPENAI_API_KEY", "OPENAI_MODEL"],
			};
		},
		async validate() {
			return { ok: true, provider: "openai", message: "ready" };
		},
		async generate() {
			return {
				outputText: "ok",
				preview: {
					title: "preview",
					summary: "summary",
					html: "<div>ok</div>",
					css: "",
					javascript: "",
				},
			};
		},
	};

	const app = createApp({ providers: [provider] });
	const response = await app.fetch(
		new Request("http://localhost/api/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jobId: "frontend-job-1",
				sessionKey: "session-1",
				providerId: "openai",
				chunk: "abcdefghijklmnopqrst",
				model: "gpt-5.4-mini",
			}),
		}),
	);
	const body = await response.json();

	assert.equal(response.status, 202);
	assert.equal(body.job.id, "frontend-job-1");
	assert.equal(body.job.provider, "openai");
	assert.equal(body.job.chunk, "abcdefghijklmnopqrst");
});

test("session init creates a stable output URL and serves default files", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-session-"));
	const provider: ProviderAdapter = {
		id: "openai",
		displayName: "OpenAI",
		configSummary() {
			return {
				provider: "openai",
				displayName: "OpenAI",
				configured: true,
				missing: [],
				requiresCli: false,
				envVars: ["OPENAI_API_KEY", "OPENAI_MODEL"],
			};
		},
		async validate() {
			return { ok: true, provider: "openai", message: "ready" };
		},
		async generate() {
			throw new Error("not used");
		},
	};

	const app = createApp({ providers: [provider], cwd });
	const init = await app.fetch(
		new Request("http://localhost/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionKey: "session-abc" }),
		}),
	);
	const initBody = await init.json();
	assert.equal(init.status, 201);
	assert.equal(initBody.sessionKey, "session-abc");
	assert.equal(initBody.previewUrl, "/outputs/session-abc/live.html");

	const file = await app.fetch(new Request("http://localhost/outputs/session-abc/index.html"));
	const html = await file.text();
	assert.equal(file.status, 200);
	assert.match(html, /Awaiting the next bark diff/i);
});

test("job generation receives the concrete session output directory", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-session-dir-"));
	let seenSessionOutputDir: string | undefined;
	const provider: ProviderAdapter = {
		id: "codex",
		displayName: "Codex CLI",
		configSummary() {
			return {
				provider: "codex",
				displayName: "Codex CLI",
				configured: true,
				missing: [],
				requiresCli: true,
				envVars: ["CODEX_CLI_PATH", "CODEX_MODEL"],
			};
		},
		async validate() {
			return { ok: true, provider: "codex", message: "ready" };
		},
		async generate(request) {
			seenSessionOutputDir = request.sessionOutputDir;
			return {
				outputText: '{"stage":"applied","thinking":["ok"],"result":{"mode":"patch","operations":[]}}',
				resultMode: "patch",
				preview: {
					title: "dir test",
					summary: "dir test",
					html: "<main>dir test</main>",
					css: "",
					javascript: "",
				},
			};
		},
	};

	const app = createApp({ providers: [provider], cwd });
	await app.fetch(
		new Request("http://localhost/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionKey: "session-dir" }),
		}),
	);

	await app.fetch(
		new Request("http://localhost/api/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sessionKey: "session-dir",
				providerId: "codex",
				chunk: "space-shooter-stagex",
				model: "gpt-5.4",
			}),
		}),
	);

	await new Promise((resolve) => setTimeout(resolve, 25));

	assert.equal(seenSessionOutputDir, join(cwd, "outputs", "session-dir"));
});

test("completed jobs persist the provider preview instead of reusing the default session scaffold", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-session-preview-"));
	const provider: ProviderAdapter = {
		id: "codex",
		displayName: "Codex CLI",
		configSummary() {
			return {
				provider: "codex",
				displayName: "Codex CLI",
				configured: true,
				missing: [],
				requiresCli: true,
				envVars: ["CODEX_CLI_PATH", "CODEX_MODEL"],
			};
		},
		async validate() {
			return { ok: true, provider: "codex", message: "ready" };
		},
		async generate() {
			return {
				outputText:
					'{"stage":"applied","thinking":["updated"],"result":{"mode":"patch","operations":[]}}',
				resultMode: "patch",
				preview: {
					title: "Starbark: Stage X",
					summary:
						"A tiny browser shooter where you dodge, auto-fire, and clear the first Stage X enemy wave.",
					html: "<main><h1>Starbark: Stage X</h1><p>Launch Run</p></main>",
					css: "body { background: black; color: white; }",
					javascript: 'document.body.dataset.mode = "stage-x";',
				},
			};
		},
	};

	const app = createApp({ providers: [provider], cwd });
	await app.fetch(
		new Request("http://localhost/api/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionKey: "session-preview" }),
		}),
	);

	await app.fetch(
		new Request("http://localhost/api/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sessionKey: "session-preview",
				providerId: "codex",
				chunk: "space-shooter-stagex",
				model: "gpt-5.4",
			}),
		}),
	);

	await new Promise((resolve) => setTimeout(resolve, 25));

	const backlog = await app.fetch(
		new Request("http://localhost/api/backlog?page=1&pageSize=10"),
	);
	const backlogBody = await backlog.json();
	assert.equal(backlogBody.total, 1);
	assert.equal(backlogBody.entries[0].status, "completed");
	assert.equal(backlogBody.entries[0].preview.title, "Starbark: Stage X");
	assert.match(
		backlogBody.entries[0].preview.summary,
		/first Stage X enemy wave/i,
	);

	const live = await app.fetch(
		new Request("http://localhost/outputs/session-preview/live.html"),
	);
	const liveHtml = await live.text();
	assert.equal(live.status, 200);
	assert.match(liveHtml, /Starbark: Stage X/);
	assert.match(liveHtml, /Launch Run/);
});

test("completed jobs leave the active queue and persist in backlog", async () => {
	const provider: ProviderAdapter = {
		id: "codex",
		displayName: "Codex CLI",
		configSummary() {
			return {
				provider: "codex",
				displayName: "Codex CLI",
				configured: true,
				missing: [],
				requiresCli: true,
				envVars: ["CODEX_CLI_PATH", "CODEX_MODEL"],
			};
		},
		async validate() {
			return { ok: true, provider: "codex", message: "ready" };
		},
		async generate() {
			return {
				outputText: "{\"title\":\"done\"}",
				preview: {
					title: "done",
					summary: "finished",
					html: "<div>done</div>",
					css: "",
					javascript: "",
				},
			};
		},
	};

	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-backlog-"));
	const app = createApp({ providers: [provider], cwd });

	const enqueue = await app.fetch(
		new Request("http://localhost/api/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sessionKey: "session-1",
				providerId: "codex",
				chunk: "ABCDEFGHIJKLMNOPQRST",
				model: "gpt-5.4",
			}),
		}),
	);
	const enqueueBody = await enqueue.json();
	const jobId = enqueueBody.job.id;

	await new Promise((resolve) => setTimeout(resolve, 25));

	const activeQueue = await app.fetch(new Request("http://localhost/api/jobs"));
	const activeBody = await activeQueue.json();
	assert.equal(activeBody.jobs.length, 0);

	const completed = await app.fetch(new Request(`http://localhost/api/jobs/${jobId}`));
	const completedBody = await completed.json();
	assert.equal(completedBody.job.status, "completed");

	const backlog = await app.fetch(
		new Request("http://localhost/api/backlog?page=1&pageSize=10"),
	);
	const backlogBody = await backlog.json();
	assert.equal(backlogBody.total, 1);
	assert.equal(backlogBody.entries[0].id, jobId);
	assert.equal(backlogBody.entries[0].status, "completed");
});

test("backlog delete clears persisted entries", async () => {
	const provider: ProviderAdapter = {
		id: "codex",
		displayName: "Codex CLI",
		configSummary() {
			return {
				provider: "codex",
				displayName: "Codex CLI",
				configured: true,
				missing: [],
				requiresCli: true,
				envVars: ["CODEX_CLI_PATH", "CODEX_MODEL"],
			};
		},
		async validate() {
			return { ok: true, provider: "codex", message: "ready" };
		},
		async generate() {
			return {
				outputText: "{\"title\":\"done\"}",
				preview: {
					title: "done",
					summary: "finished",
					html: "<div>done</div>",
					css: "",
					javascript: "",
				},
			};
		},
	};

	const cwd = await mkdtemp(join(tmpdir(), "vibe-barking-backlog-clear-"));
	const app = createApp({ providers: [provider], cwd });

	await app.fetch(
		new Request("http://localhost/api/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				providerId: "codex",
				chunk: "ABCDEFGHIJKLMNOPQRST",
				model: "gpt-5.4",
			}),
		}),
	);
	await new Promise((resolve) => setTimeout(resolve, 25));

	const cleared = await app.fetch(
		new Request("http://localhost/api/backlog", {
			method: "DELETE",
		}),
	);
	assert.equal(cleared.status, 200);

	const backlog = await app.fetch(
		new Request("http://localhost/api/backlog?page=1&pageSize=10"),
	);
	const backlogBody = await backlog.json();
	assert.equal(backlogBody.total, 0);
	assert.deepEqual(backlogBody.entries, []);
});
