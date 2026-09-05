import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setGoal, updatePlan } from '../src/harness/tools.js';
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

  it('persists a session-private checkpoint without writing into masked workspace metadata', async () => {
    let writtenPath = '';
    let written = '';
    const result = await updatePlan.run({
      objective: 'Ship stable rendering',
      explanation: 'The multiline regression is reproduced.',
      plan: [
        { step: 'Fix the frame budget', status: 'in_progress' },
        { step: 'Run the preview', status: 'pending' },
      ],
    }, {
      workspace: 'C:/workspace',
      container: {
        workdir: '/workspace',
        writeFile: async (file: string, content: string) => {
          writtenPath = file;
          written = content;
        },
      },
    } as unknown as ToolContext);

    assert.equal(writtenPath, '/temp/plif/plans/current.md');
    assert.match(written, /# Plif execution checkpoint/);
    assert.match(written, /Ship stable rendering/);
    assert.match(written, /Fix the frame budget/);
    assert.match(result.output, /Durable checkpoint/);
  });

  it('keeps the accepted plan usable when the runtime checkpoint mirror is unavailable', async () => {
    const result = await updatePlan.run({
      plan: [{ step: 'Create the user file', status: 'in_progress' }],
    }, {
      workspace: 'C:/workspace',
      container: {
        writeFile: async () => { throw new Error('runtime mount is masked'); },
      },
    } as unknown as ToolContext);

    assert.equal(result.ok, true);
    assert.match(result.output, /Checkpoint mirror unavailable/);
  });
});

describe('set_goal', () => {
  it('records context without pretending to execute the objective', async () => {
    let recorded = '';
    const result = await setGoal.run(
      { condition: 'all tests pass' },
      { setGoal: async (condition) => { recorded = condition; } } as never,
    );

    assert.equal(result.ok, true);
    assert.equal(recorded, 'all tests pass');
    assert.match(result.output, /without starting work/);
  });
});
