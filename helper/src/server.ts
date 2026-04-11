import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { createApp, handleNodeRequest } from "./app.ts";
import { loadHelperRuntimeEnv } from "./config/env-store.ts";

const helperRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeEnv = loadHelperRuntimeEnv({
	cwd: helperRoot,
	baseEnv: process.env,
});
const app = createApp({ cwd: helperRoot, env: runtimeEnv });
const host = runtimeEnv.HELPER_HOST ?? "127.0.0.1";
const port = Number(runtimeEnv.HELPER_PORT ?? "4318");

const server = createServer(async (req, res) => {
	const chunks: Buffer[] = [];

	req.on("data", (chunk) => {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	});

	req.on("end", async () => {
		try {
			const response = await handleNodeRequest(app.fetch, {
				url: `http://${req.headers.host ?? `${host}:${port}`}${req.url ?? "/"}`,
				method: req.method ?? "GET",
				headers: req.headers,
				body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
			});

			res.statusCode = response.status;
			response.headers.forEach((value, key) => {
				res.setHeader(key, value);
			});
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch (error) {
			res.statusCode = 500;
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(
				JSON.stringify({
					error:
						error instanceof Error ? error.message : "Internal server error",
				}),
			);
		}
	});
});

server.listen(port, host, () => {
	console.log(`vibe-barking helper listening on http://${host}:${port}`);
});
