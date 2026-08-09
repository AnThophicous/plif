import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { updatePlan } from '../src/harness/tools.js';
import type { ToolContext } from '../src/harness/tools.js';

const context = {} as ToolContext;

describe('update_plan', () => {
  it('accepts a compact checkpoint plan', async () => {
    const result = await updatePlan.run({
      plan: [
        { step: 'Inspect the renderer', status: 'completed' },
        { step: 'Implement the compact row', status: 'in_progress' },
        { step: 'Verify the build', status: 'pending' },
      ],
    }, context);

    assert.equal(result.ok, true);
    assert.match(result.output, /1\/3 checkpoints completed/);
    assert.match(result.output, /Implement the compact row/);
  });

  it('rejects more than six checkpoints', async () => {
    await assert.rejects(
      updatePlan.run({
        plan: Array.from({ length: 7 }, (_, index) => ({ step: `Step ${index + 1}`, status: 'pending' })),
      }, context),
      /between 1 and 6 checkpoints/,
    );
  });

  it('rejects multiple checkpoints in progress', async () => {
    await assert.rejects(
      updatePlan.run({
        plan: [
          { step: 'First', status: 'in_progress' },
          { step: 'Second', status: 'in_progress' },
        ],
      }, context),
      /at most one checkpoint in progress/,
    );
  });
});
