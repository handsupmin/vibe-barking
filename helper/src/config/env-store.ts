import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertSafeExecutablePath } from "../security/executable-path.ts";
import type { ProviderId } from "../types.ts";

interface LoadHelperRuntimeEnvInput {
	cwd?: string;
	baseEnv?: NodeJS.ProcessEnv;
}

interface PersistProviderConfigInput {
	cwd?: string;
	env: NodeJS.ProcessEnv;
	providerId: ProviderId;
	secret?: string;
	model?: string;
	command?: string;
}

interface ProviderEnvKeys {
	secretKey?: string;
	modelKey?: string;
	commandKey?: string;
}

const HELPER_ENV_FILE = ".env.local";

const PROVIDER_ENV_KEYS: Record<ProviderId, ProviderEnvKeys> = {
	openai: {
		secretKey: "OPENAI_API_KEY",
		modelKey: "OPENAI_MODEL",
	},
	gemini: {
		secretKey: "GEMINI_API_KEY",
		modelKey: "GEMINI_MODEL",
	},
	claude: {
		secretKey: "ANTHROPIC_API_KEY",
		modelKey: "ANTHROPIC_MODEL",
	},
	"claude-code": {
		commandKey: "CLAUDE_CODE_CLI_PATH",
		modelKey: "CLAUDE_CODE_MODEL",
	},
	codex: {
		commandKey: "CODEX_CLI_PATH",
		modelKey: "CODEX_MODEL",
	},
};

export function resolveHelperEnvFile(cwd = process.cwd()): string {
	return join(cwd, HELPER_ENV_FILE);
}

export function loadHelperRuntimeEnv({
	cwd = process.cwd(),
	baseEnv = process.env,
}: LoadHelperRuntimeEnvInput = {}): NodeJS.ProcessEnv {
	const persistedEnv = readHelperEnvFile(cwd);
	return {
		...persistedEnv,
		...baseEnv,
	};
}

export async function persistProviderConfig({
	cwd = process.cwd(),
	env,
	providerId,
	secret,
	model,
	command,
}: PersistProviderConfigInput): Promise<void> {
	const persistedEnv = readHelperEnvFile(cwd);
	const keys = PROVIDER_ENV_KEYS[providerId];

	setIfPresent(persistedEnv, env, keys.secretKey, secret);
	setIfPresent(persistedEnv, env, keys.modelKey, model);

	const nextCommand = normalizeValue(command);
	if (keys.commandKey && nextCommand) {
		assertSafeExecutablePath(nextCommand, "provider executable path");
		persistedEnv[keys.commandKey] = nextCommand;
		env[keys.commandKey] = nextCommand;
	}

	const filePath = resolveHelperEnvFile(cwd);
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, serializeEnvFile(persistedEnv), "utf8");
}

function readHelperEnvFile(cwd: string): NodeJS.ProcessEnv {
	const filePath = resolveHelperEnvFile(cwd);
	if (!existsSync(filePath)) {
		return {};
	}

	return parseEnvFile(readFileSync(filePath, "utf8"));
}

function parseEnvFile(contents: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};

	for (const rawLine of contents.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}

		const separatorIndex = line.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		env[key] = unquoteEnvValue(value);
	}

	return env;
}

function serializeEnvFile(entries: NodeJS.ProcessEnv): string {
	return Object.entries(entries)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string")
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
		.join("\n")
		.concat("\n");
}

function setIfPresent(
	persistedEnv: NodeJS.ProcessEnv,
	runtimeEnv: NodeJS.ProcessEnv,
	key: string | undefined,
	value: string | undefined,
): void {
	const nextValue = normalizeValue(value);
	if (!key || !nextValue) {
		return;
	}

	persistedEnv[key] = nextValue;
	runtimeEnv[key] = nextValue;
}

function normalizeValue(value?: string): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function quoteEnvValue(value: string): string {
	return /^[A-Za-z0-9_./:@-]+$/u.test(value)
		? value
		: JSON.stringify(value);
}

function unquoteEnvValue(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}

	return value;
}
