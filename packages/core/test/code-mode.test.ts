import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlifError, runCodeMode } from '../src/index.js';

test('Code Mode fails closed until it has a process-isolated runtime', async () => {
  await assert.rejects(
    runCodeMode({
      source: 'async function main() { return 42; }',
      tools: new Map(),
      call: async () => ({ output: '', ok: true }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof PlifError);
      assert.equal(error.code, 'POLICY_DENIED');
      assert.match(error.message, /process-isolated runtime/);
      assert.match(error.hint ?? '', /run_script/);
      return true;
    },
  );
});
