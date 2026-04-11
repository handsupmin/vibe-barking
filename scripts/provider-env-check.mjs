import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const providerSpecs = {
  openai: {
    requiredAny: ['OPENAI_API_KEY'],
  },
  gemini: {
    requiredAny: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  },
  claude: {
    requiredAny: ['ANTHROPIC_API_KEY'],
  },
  codex: {
    binaryEnv: ['CODEX_BIN', 'CODEX_CLI_PATH'],
    optionalAny: ['OPENAI_API_KEY'],
  },
}

export function parseProviders(argv) {
  const index = argv.indexOf('--provider')
  const raw = index >= 0 ? argv[index + 1] : 'all'

  if (!raw) {
    throw new Error('Missing value for --provider')
  }

  if (raw === 'all') {
    return Object.keys(providerSpecs)
  }

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function resolveCodexBinary(env = process.env) {
  return env.CODEX_BIN || env.CODEX_CLI_PATH || 'codex'
}

export function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
  })

  return !result.error
}

function hasAnyEnv(env, keys) {
  return keys.some((key) => Boolean(env[key]))
}

export function evaluateProvider(
  provider,
  env = process.env,
  options = { commandExists },
) {
  if (!providerSpecs[provider]) {
    throw new Error(`Unsupported provider: ${provider}`)
  }

  if (provider === 'codex') {
    const binary = resolveCodexBinary(env)
    const binaryAvailable = options.commandExists(binary)

    if (!binaryAvailable) {
      return {
        provider,
        status: 'missing',
        summary: `Missing Codex CLI binary (${binary})`,
        details: [
          `Install Codex CLI or point CODEX_BIN/CODEX_CLI_PATH to the binary.`,
        ],
      }
    }

    if (hasAnyEnv(env, providerSpecs.codex.optionalAny)) {
      return {
        provider,
        status: 'ready',
        summary: 'Codex CLI binary found and OPENAI_API_KEY is set',
        details: [`Binary: ${binary}`],
      }
    }

    return {
      provider,
      status: 'manual',
      summary: 'Codex CLI binary found, but auth must be verified manually',
      details: [
        `Binary: ${binary}`,
        'Confirm helper-side validation succeeds on a machine with Codex CLI already authenticated, or export OPENAI_API_KEY before running end-to-end validation.',
      ],
    }
  }

  const spec = providerSpecs[provider]
  const keys = spec.requiredAny

  if (hasAnyEnv(env, keys)) {
    return {
      provider,
      status: 'ready',
      summary: `Found required environment: ${keys.join(' or ')}`,
      details: [],
    }
  }

  return {
    provider,
    status: 'missing',
    summary: `Missing required environment: ${keys.join(' or ')}`,
    details: [],
  }
}

export function evaluateProviders(
  providers,
  env = process.env,
  options = { commandExists },
) {
  return providers.map((provider) => evaluateProvider(provider, env, options))
}

export function formatResults(results) {
  return results
    .map((result) => {
      const lines = [
        `${result.status.toUpperCase()} ${result.provider}: ${result.summary}`,
      ]

      for (const detail of result.details) {
        lines.push(`  - ${detail}`)
      }

      return lines.join('\n')
    })
    .join('\n')
}

function isMainModule(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl)
}

if (isMainModule(import.meta.url)) {
  const providers = parseProviders(process.argv.slice(2))
  const results = evaluateProviders(providers)

  console.log(formatResults(results))

  const hasMissing = results.some((result) => result.status === 'missing')
  process.exit(hasMissing ? 1 : 0)
}

