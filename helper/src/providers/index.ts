import { createClaudeProvider } from "./claude.ts";
import { createClaudeCodeProvider } from "./claude-code.ts";
import { createCodexCliProvider } from "./codex-cli.ts";
import { createGeminiProvider } from "./gemini.ts";
import { createOpenAIProvider } from "./openai.ts";
import type { ProviderAdapter } from "./provider.ts";

interface CreateProvidersOptions {
	env?: NodeJS.ProcessEnv;
	fetchFn?: typeof fetch;
	cwd?: string;
}

export function createProviders({
	env = process.env,
	fetchFn = fetch,
	cwd = process.cwd(),
}: CreateProvidersOptions = {}): ProviderAdapter[] {
	return [
		createOpenAIProvider({ env, fetchFn }),
		createGeminiProvider({ env, fetchFn }),
		createClaudeProvider({ env, fetchFn }),
		createClaudeCodeProvider({ env, cwd }),
		createCodexCliProvider({ env, cwd }),
	];
}
