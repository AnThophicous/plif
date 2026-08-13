/** Transcript behavior that remains independent of native terminal scrollback. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { entry, initialSession, sessionReducer } from '../src/session.js';
import type { TimelineEntry } from '../src/session.js';

describe('native terminal scrolling', () => {
  it('keeps no application-owned viewport state', () => {
    assert.equal('follow' in initialSession, false);
    assert.equal('scrollOffset' in initialSession, false);
  });
});

describe('cycle separators', () => {
  const separator = (): TimelineEntry => entry('separator', 'Worked', { durationMs: 12_000 });

  it('never opens the frame with one', () => {
    const state = sessionReducer(initialSession, { type: 'append', entry: separator() });
    assert.equal(state.entries.length, 0);
  });

  it('never draws two in a row', () => {
    let state = sessionReducer(initialSession, { type: 'append', entry: entry('answer', 'hi') });
    state = sessionReducer(state, { type: 'append', entry: separator() });
    state = sessionReducer(state, { type: 'append', entry: separator() });
    state = sessionReducer(state, { type: 'append', entry: separator() });

    assert.deepEqual(state.entries.map((item) => item.kind), ['answer', 'separator']);
  });

  it('draws one again once something happened after the last', () => {
    let state = sessionReducer(initialSession, { type: 'append', entry: entry('answer', 'hi') });
    state = sessionReducer(state, { type: 'append', entry: separator() });
    state = sessionReducer(state, { type: 'append', entry: entry('tool', 'Bash') });
    state = sessionReducer(state, { type: 'append', entry: separator() });

    assert.deepEqual(
      state.entries.map((item) => item.kind),
      ['answer', 'separator', 'tool', 'separator'],
    );
  });
});
