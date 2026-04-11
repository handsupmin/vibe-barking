import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.ts';
import type { ProviderAdapter } from '../src/providers/provider.ts';

test('createApp exposes helper metadata without leaking secrets', async () => {
  const provider: ProviderAdapter = {
    id: 'openai',
    displayName: 'OpenAI',
    configSummary() {
      return {
        provider: 'openai',
        displayName: 'OpenAI',
        configured: true,
        missing: [],
        requiresCli: false,
        envVars: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
      };
    },
    async validate() {
      return { ok: true, message: 'ready' };
    },
    async generate() {
      return {
        outputText: 'ok',
        preview: {
          title: 'preview',
          summary: 'summary',
          html: '<div>ok</div>',
          css: '',
          javascript: '',
        },
      };
    },
  };

  const app = createApp({ providers: [provider] });
  const response = await app.fetch(new Request('http://localhost/api/meta'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.providers[0].provider, 'openai');
  assert.equal(body.providers[0].configured, true);
  assert.equal(JSON.stringify(body), JSON.stringify(body).includes('OPENAI_API_KEY=') ? true : false, false);
  assert.deepEqual(body.categories, ['landing-page', 'dashboard', 'widget', 'playground']);
});
