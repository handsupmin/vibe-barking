import test from 'node:test';
import assert from 'node:assert/strict';

import { framePrompt } from '../src/prompts/frame-prompt.ts';

test('framePrompt returns stable cryptographer instructions with chunk + category context', () => {
  const prompt = framePrompt({
    chunk: 'woofwoofwoofwoofwoof',
    category: 'widget',
    sequence: 3,
  });

  assert.match(prompt.system, /strict json/i);
  assert.match(prompt.system, /cryptographer/i);
  assert.match(prompt.user, /woofwoofwoofwoofwoof/);
  assert.match(prompt.user, /widget/i);
  assert.match(prompt.user, /chunk #3/i);
});
