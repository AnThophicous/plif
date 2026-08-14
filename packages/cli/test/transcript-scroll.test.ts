import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  initialViewport,
  viewportReducer,
  visibleTranscriptSlice,
} from '../src/transcript/scroll.js';

describe('transcript viewport', () => {
  it('opens at the live tail', () => {
    const state = viewportReducer(initialViewport, {
      type: 'open', contentLines: 120, height: 30,
    });

    assert.equal(state.offset, 90);
    assert.equal(state.follow, true);
  });

  it('suspends follow when moving upward and restores it at the end', () => {
    let state = viewportReducer(initialViewport, {
      type: 'open', contentLines: 120, height: 30,
    });
    state = viewportReducer(state, {
      type: 'line', delta: -1, contentLines: 120, height: 30,
    });
    assert.equal(state.follow, false);
    state = viewportReducer(state, {
      type: 'end', contentLines: 120, height: 30,
    });
    assert.equal(state.follow, true);
  });

  it('jumps from an older position back to the live bottom', () => {
    const state = viewportReducer(
      { open: true, offset: 12, follow: false },
      { type: 'end', contentLines: 120, height: 30 },
    );

    assert.deepEqual(state, { open: true, offset: 90, follow: true });
  });

  it('clamps the offset after a resize', () => {
    const state = viewportReducer(
      { open: true, offset: 90, follow: false },
      { type: 'resize', contentLines: 50, height: 25 },
    );

    assert.equal(state.offset, 25);
  });

  it('keeps following when content grows at the live tail', () => {
    const state = viewportReducer(
      { open: true, offset: 90, follow: true },
      { type: 'content', contentLines: 160, height: 30 },
    );

    assert.equal(state.offset, 130);
  });

  it('selects whole items intersecting the visible line window', () => {
    const items = [{ id: 'a', lines: 3 }, { id: 'b', lines: 4 }, { id: 'c', lines: 2 }];
    const visible = visibleTranscriptSlice(
      items,
      { open: true, offset: 3, follow: false },
      4,
      (item) => item.lines,
    );

    assert.deepEqual(visible.map((item) => item.id), ['b']);
  });
});
