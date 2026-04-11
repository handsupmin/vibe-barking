import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadHelperRuntimeEnv,
  persistProviderConfig,
  resolveHelperEnvFile,
} from '../src/config/env-store.ts'

test('loadHelperRuntimeEnv merges .env.local values with shell env precedence', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'vibe-barking-env-'))
  await writeFile(
    resolveHelperEnvFile(cwd),
    'OPENAI_API_KEY=file-key\nOPENAI_MODEL=file-model\nHELPER_PORT=4999\n',
  )

  const env = await loadHelperRuntimeEnv({
    cwd,
    baseEnv: {
      OPENAI_MODEL: 'shell-model',
      HELPER_HOST: '0.0.0.0',
    },
  })

  assert.equal(env.OPENAI_API_KEY, 'file-key')
  assert.equal(env.OPENAI_MODEL, 'shell-model')
  assert.equal(env.HELPER_PORT, '4999')
  assert.equal(env.HELPER_HOST, '0.0.0.0')
})

test('persistProviderConfig writes API and CLI settings to .env.local and mutates runtime env', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'vibe-barking-env-save-'))
  const env = await loadHelperRuntimeEnv({ cwd, baseEnv: {} })

  await persistProviderConfig({
    cwd,
    env,
    providerId: 'openai',
    secret: 'openai-key',
    model: 'gpt-5.4-mini',
  })

  await persistProviderConfig({
    cwd,
    env,
    providerId: 'claude-code',
    command: 'claude',
    model: 'sonnet',
  })

  const saved = await readFile(resolveHelperEnvFile(cwd), 'utf8')

  assert.match(saved, /OPENAI_API_KEY=openai-key/)
  assert.match(saved, /OPENAI_MODEL=gpt-5.4-mini/)
  assert.match(saved, /CLAUDE_CODE_CLI_PATH=claude/)
  assert.match(saved, /CLAUDE_CODE_MODEL=sonnet/)
  assert.equal(env.OPENAI_API_KEY, 'openai-key')
  assert.equal(env.CLAUDE_CODE_CLI_PATH, 'claude')
})
