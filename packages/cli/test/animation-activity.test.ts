import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { animationClockActive } from '../src/animation-activity.js';
import type { AnimationActivity } from '../src/animation-activity.js';

const IDLE_PLIF: AnimationActivity = {
  effort: 'plif',
  busy: false,
  compacting: false,
  browserLoading: false,
  runningTask: false,
  runningSubagent: false,
  runningDiscovery: false,
};

describe('application animation activity', () => {
  it('keeps an idle prompt still until a transition or real work begins', () => {
    assert.equal(animationClockActive(IDLE_PLIF), false);
  });

  it('keeps the clock alive for real foreground and background work', () => {
    for (const field of [
      'busy',
      'compacting',
      'browserLoading',
      'runningTask',
      'runningSubagent',
      'runningDiscovery',
    ] as const) {
      assert.equal(animationClockActive({ ...IDLE_PLIF, [field]: true }), true, field);
    }
    assert.equal(animationClockActive({ ...IDLE_PLIF, runningTimeline: true }), true, 'timeline');
  });

  it('animates a bounded effort transition while otherwise idle', () => {
    assert.equal(animationClockActive({ ...IDLE_PLIF, effortTransitioning: true }), true);
  });
});
