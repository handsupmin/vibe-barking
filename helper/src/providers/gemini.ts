import { normalizePreviewDocument } from '../preview/normalize-preview.ts';
import type { ProviderAdapter } from './provider.ts';
import type { ProviderGenerationRequest, ProviderGenerationResult, ProviderValidationResult } from '../types.ts';

interface GeminiProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}

export function createGeminiProvider({ env = process.env, fetchFn = fetch }: GeminiProviderOptions = {}): ProviderAdapter {
  const displayName = 'Gemini';

  return {
    id: 'gemini',
    displayName,
    configSummary() {
      const missing = requiredEnv(env, ['GEMINI_API_KEY', 'GEMINI_MODEL']);
      return {
        provider: 'gemini',
        displayName,
        configured: missing.length === 0,
        missing,
        requiresCli: false,
        envVars: ['GEMINI_API_KEY', 'GEMINI_MODEL'],
      };
    },
    async validate(input) {
      return validateGemini({ env, fetchFn, model: input?.model });
    },
    async generate(request) {
      return generateGemini({ env, fetchFn, request });
    },
  };
}

async function validateGemini({
  env,
  fetchFn,
  model,
}: {
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
  model?: string;
}): Promise<ProviderValidationResult> {
  const effectiveModel = model ?? env.GEMINI_MODEL;
  const missing = requiredEnv({ ...env, GEMINI_MODEL: effectiveModel }, ['GEMINI_API_KEY', 'GEMINI_MODEL']);
  if (missing.length > 0) {
    return {
      ok: false,
      provider: 'gemini',
      model: effectiveModel,
      message: `Missing ${missing.join(', ')}`,
    };
  }

  try {
    const response = await fetchGemini(fetchFn, env.GEMINI_API_KEY!, effectiveModel!, 'Reply with READY and nothing else.');
    if (!response.ok) {
      const payload = await response.json();
      return {
        ok: false,
        provider: 'gemini',
        model: effectiveModel,
        message: `Gemini validation failed: ${extractErrorMessage(payload)}`,
      };
    }

    return {
      ok: true,
      provider: 'gemini',
      model: effectiveModel,
      message: 'Gemini responded successfully.',
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'gemini',
      model: effectiveModel,
      message: error instanceof Error ? error.message : 'Gemini validation failed.',
    };
  }
}

async function generateGemini({
  env,
  fetchFn,
  request,
}: {
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
  request: ProviderGenerationRequest;
}): Promise<ProviderGenerationResult> {
  const effectiveModel = request.model ?? env.GEMINI_MODEL;
  const missing = requiredEnv({ ...env, GEMINI_MODEL: effectiveModel }, ['GEMINI_API_KEY', 'GEMINI_MODEL']);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}`);
  }

  const response = await fetchGemini(fetchFn, env.GEMINI_API_KEY!, effectiveModel!, `${request.prompt.system}\n\n${request.prompt.user}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Gemini generate failed: ${extractErrorMessage(payload)}`);
  }

  const outputText = extractGeminiText(payload);
  return {
    outputText,
    preview: normalizePreviewDocument(outputText),
  };
}

function fetchGemini(fetchFn: typeof fetch, apiKey: string, model: string, prompt: string): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return fetchFn(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    }),
  });
}

function extractGeminiText(payload: any): string {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text)
    ?.filter((value: unknown) => typeof value === 'string')
    ?.join('\n');

  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  throw new Error('Gemini did not return text output.');
}

function extractErrorMessage(payload: any): string {
  return payload?.error?.message ?? payload?.message ?? 'Unknown error';
}

function requiredEnv(env: NodeJS.ProcessEnv, keys: string[]): string[] {
  return keys.filter((key) => !env[key]);
}
