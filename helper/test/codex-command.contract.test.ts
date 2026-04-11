import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCodexCommand } from '../src/security/codex-command-policy.ts';

const providerContract = JSON.parse(
  readFileSync(
    new URL('../../verification/contracts/provider-validation.json', import.meta.url),
    'utf8',
  ),
);

const codexContract = providerContract.providers.find(
  (provider: { name: string }) => provider.name === 'codex',
);

test('codex contract keeps execution helper-only and allowlisted', () => {
  assert.equal(codexContract.clientMayProvideCommand, false);

  const command = buildCodexCommand({ codexPath: 'codex', model: 'gpt-5.4' });

  assert.equal(command.command, 'codex');
  assert.equal(command.args[0], 'exec');
  assert.ok(command.args.includes('--sandbox'));
  assert.ok(command.args.includes('read-only'));
  assert.ok(command.args.every((arg) => !/[;&|]/.test(arg)));
});
