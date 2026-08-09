import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeToolCall, toolLane } from '../src/format.js';

describe('planning tool presentation', () => {
  it('keeps checkpoints structured for the compact timeline row', () => {
    const described = describeToolCall('update_plan', {
      explanation: 'The approach changed.',
      plan: [
        { step: 'Inspect the renderer', status: 'completed' },
        { step: 'Implement the compact row', status: 'in_progress' },
        { step: 'Verify the build', status: 'pending' },
      ],
    });

    assert.equal(described.label, 'Plan updated');
    assert.equal(described.target, undefined);
    assert.deepEqual(described.planItems, [
      { step: 'Inspect the renderer', status: 'completed' },
      { step: 'Implement the compact row', status: 'in_progress' },
      { step: 'Verify the build', status: 'pending' },
    ]);
  });

  it('does not leak malformed checkpoints into the UI', () => {
    const described = describeToolCall('update_plan', {
      plan: [
        { step: '', status: 'completed' },
        { step: 'Valid', status: 'pending' },
        { step: 'Broken', status: 'wat' },
      ],
    });
    assert.deepEqual(described.planItems, [{ step: 'Valid', status: 'pending' }]);
  });
});

describe('tool timeline lanes', () => {
  it('keeps discovery and child sessions out of ordinary history rows', () => {
    assert.equal(toolLane('read_file'), 'discovery');
    assert.equal(toolLane('list_dir'), 'discovery');
    assert.equal(toolLane('subagent'), 'subagent');
    assert.equal(toolLane('run_command'), 'timeline');
  });
});
