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
		"landing-page",
		"dashboard",
		"widget",
		"playground",
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
				providerId: "openai",
				chunk: "abcdefghijklmnopqrst",
				model: "gpt-5.4-mini",
			}),
		}),
	);
	const body = await response.json();

	assert.equal(response.status, 202);
	assert.equal(body.job.provider, "openai");
	assert.equal(body.job.chunk, "abcdefghijklmnopqrst");
});
