import { normalizePreviewDocument } from '../preview/normalize-preview.ts';
import type { ProviderAdapter } from './provider.ts';
import type { ProviderGenerationRequest, ProviderGenerationResult, ProviderValidationResult } from '../types.ts';

interface OpenAIProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}

export function createOpenAIProvider({ env = process.env, fetchFn = fetch }: OpenAIProviderOptions = {}): ProviderAdapter {
  const displayName = 'OpenAI';

  return {
    id: 'openai',
    displayName,
    configSummary() {
      const missing = requiredEnv(env, ['OPENAI_API_KEY', 'OPENAI_MODEL']);
      return {
        provider: 'openai',
        displayName,
        configured: missing.length === 0,
        missing,
        requiresCli: false,
        envVars: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
      };
    },
    async validate(input) {
      return validateOpenAI({ env, fetchFn, model: input?.model });
    },
    async generate(request) {
      return generateOpenAI({ env, fetchFn, request });
    },
  };
}

async function validateOpenAI({
  env,
  fetchFn,
  model,
}: {
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
  model?: string;
}): Promise<ProviderValidationResult> {
  const effectiveModel = model ?? env.OPENAI_MODEL;
  const missing = requiredEnv({ ...env, OPENAI_MODEL: effectiveModel }, ['OPENAI_API_KEY', 'OPENAI_MODEL']);
  if (missing.length > 0) {
    return {
      ok: false,
      provider: 'openai',
      model: effectiveModel,
      message: `Missing ${missing.join(', ')}`,
    };
  }

  try {
    const response = await fetchFn('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: effectiveModel,
        input: 'Reply with READY and nothing else.',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return {
        ok: false,
        provider: 'openai',
        model: effectiveModel,
        message: `OpenAI validation failed: ${extractErrorMessage(payload)}`,
      };
    }

    return {
      ok: true,
      provider: 'openai',
      model: effectiveModel,
      message: 'OpenAI responded successfully.',
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'openai',
      model: effectiveModel,
      message: error instanceof Error ? error.message : 'OpenAI validation failed.',
    };
  }
}

async function generateOpenAI({
  env,
  fetchFn,
  request,
}: {
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
  request: ProviderGenerationRequest;
}): Promise<ProviderGenerationResult> {
  const effectiveModel = request.model ?? env.OPENAI_MODEL;
  const missing = requiredEnv({ ...env, OPENAI_MODEL: effectiveModel }, ['OPENAI_API_KEY', 'OPENAI_MODEL']);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}`);
  }

  const response = await fetchFn('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: effectiveModel,
      input: `${request.prompt.system}\n\n${request.prompt.user}`,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI generate failed: ${extractErrorMessage(payload)}`);
  }

  const outputText = extractOpenAIText(payload);
  return {
    outputText,
    preview: normalizePreviewDocument(outputText),
  };
}

function extractOpenAIText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const text = payload?.output
    ?.flatMap((item: any) => item?.content ?? [])
    ?.map((item: any) => item?.text)
    ?.filter((value: unknown) => typeof value === 'string')
    ?.join('\n');

  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  throw new Error('OpenAI did not return text output.');
}

function extractErrorMessage(payload: any): string {
  return payload?.error?.message ?? payload?.message ?? 'Unknown error';
}

function requiredEnv(env: NodeJS.ProcessEnv, keys: string[]): string[] {
  return keys.filter((key) => !env[key]);
}
