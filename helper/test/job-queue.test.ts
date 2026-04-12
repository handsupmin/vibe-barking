import assert from "node:assert/strict";
import test from "node:test";

import { JobQueue } from "../src/queue/job-queue.ts";

test("JobQueue processes jobs sequentially in enqueue order", async () => {
	const seen: string[] = [];
	const settled: string[] = [];
	const queue = new JobQueue({
		processJob: async (job) => {
			seen.push(`start:${job.id}`);
			await new Promise((resolve) => setTimeout(resolve, 5));
			seen.push(`finish:${job.id}`);
			return {
				outputText: `done:${job.chunk}`,
				preview: {
					title: `job-${job.id}`,
					summary: `processed ${job.chunk}`,
					html: `<div>${job.chunk}</div>`,
					css: "",
					javascript: "",
				},
			};
		},
		onTerminalState: (job) => {
			settled.push(`${job.status}:${job.id}`);
		},
	});

	const first = queue.enqueue({
		sessionKey: "session-a",
		provider: "openai",
		chunk: "aaaaaaaaaaaaaaaaaaaa",
	});
	const second = queue.enqueue({
		sessionKey: "session-a",
		provider: "claude",
		chunk: "bbbbbbbbbbbbbbbbbbbb",
	});

	await queue.onIdle();

	assert.deepEqual(seen, [
		`start:${first.id}`,
		`finish:${first.id}`,
		`start:${second.id}`,
		`finish:${second.id}`,
	]);
	assert.deepEqual(settled, [
		`completed:${first.id}`,
		`completed:${second.id}`,
	]);
	assert.equal(queue.get(first.id)?.status, "completed");
	assert.equal(queue.get(second.id)?.status, "completed");
	assert.equal(queue.listActive().length, 0);
});
