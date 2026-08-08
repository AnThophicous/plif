import assert from 'node:assert/strict';
import { it } from 'node:test';

import { DEFAULT_CONTEXT_TOKENS } from '../src/harness/loop.js';

it('uses the one-million-token DeepSeek context budget', () => {
  assert.equal(DEFAULT_CONTEXT_TOKENS, 1_000_000);
});
