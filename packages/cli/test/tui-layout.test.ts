import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveLiveStatus, plifDockItems } from '../src/live-status.js';
import { cellSpacing } from '../src/components/Timeline.js';

describe('minimal TUI hierarchy', () => {
  it('shows one authoritative running state by priority', () => {
    assert.deepEqual(
      deriveLiveStatus({ agent: true, mcp: 'connecting github', compacting: false, queued: 2 }),
      { kind: 'agent', label: 'Working', interruptible: true, queued: 2 },
    );
    assert.deepEqual(
      deriveLiveStatus({ agent: false, mcp: 'connecting github', compacting: false, queued: 0 }),
      { kind: 'mcp', label: 'Connecting github', interruptible: false, queued: 0 },
    );
  });

  it('lets dialogs outrank every background running state', () => {
    assert.deepEqual(
      deriveLiveStatus({
        approval: true,
        agent: true,
        compacting: true,
        mcp: 'connecting github',
        queued: 1,
      }),
      { kind: 'approval', label: 'Approval required', interruptible: false, queued: 1 },
    );
  });

  it('collapses dock facts by width without dropping the working state', () => {
    const facts = {
      workspace: 'C:\\src\\plif',
      model: 'openai/gpt-5',
      effort: 'high',
      contextUsed: 40_000,
      contextMax: 128_000,
      working: true,
    } as const;

    assert.deepEqual(plifDockItems(52, facts), ['workspace', 'context', 'working']);
    assert.deepEqual(plifDockItems(28, facts), ['working']);
  });

  it('uses compact intra-turn spacing and a larger turn boundary', () => {
    assert.equal(cellSpacing({ previousTurnId: 'a', turnId: 'a' }), 0);
    assert.equal(cellSpacing({ previousTurnId: 'a', turnId: 'b' }), 1);
    assert.equal(cellSpacing({ previousTurnId: null, turnId: 'a' }), 0);
  });
});
