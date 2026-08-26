import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_CLICK_SEQUENCE,
  needsPasteClickTracking,
  nextClickSequence,
  parseSgrMouse,
  SgrMouseReader,
} from '../src/mouse.js';

describe('SGR mouse input', () => {
  it('keeps native terminal scrolling unless a text paste needs click tracking', () => {
    assert.equal(needsPasteClickTracking([]), false);
    assert.equal(needsPasteClickTracking([{ kind: 'image' }]), false);
    assert.equal(needsPasteClickTracking([{ kind: 'text' }]), true);
  });

  it('parses raw and Ink-normalized primary button presses', () => {
    assert.deepEqual(parseSgrMouse('\u001b[<0;18;34M'), {
      button: 0,
      column: 18,
      row: 34,
      action: 'press',
    });
    assert.deepEqual(parseSgrMouse('[<0;18;34m'), {
      button: 0,
      column: 18,
      row: 34,
      action: 'release',
    });
  });

  it('parses motion for active chooser hover and ignores wheel events', () => {
    assert.deepEqual(parseSgrMouse('[<32;18;34M'), {
      button: 0,
      column: 18,
      row: 34,
      action: 'move',
    });
    assert.equal(parseSgrMouse('[<64;18;34M'), null);
  });

  it('holds a split SGR report outside the text pipeline', () => {
    const reader = new SgrMouseReader();
    assert.deepEqual(reader.read('[<0;18;34'), { handled: true, event: null });
    assert.deepEqual(reader.read('M'), {
      handled: true,
      event: { button: 0, column: 18, row: 34, action: 'press' },
    });
    assert.deepEqual(reader.read('x'), { handled: false, event: null });
  });

  it('replays a literal bracketed prefix when it is not a mouse report', () => {
    const reader = new SgrMouseReader();
    assert.deepEqual(reader.read('[<'), { handled: true, event: null });
    assert.deepEqual(reader.read('not mouse'), {
      handled: true,
      event: null,
      text: '[<not mouse',
    });
  });

  it('opens only after three clicks at the same point within the window', () => {
    const first = nextClickSequence(EMPTY_CLICK_SEQUENCE, { column: 18, row: 34 }, 1000);
    const second = nextClickSequence(first, { column: 18, row: 34 }, 1200);
    const third = nextClickSequence(second, { column: 19, row: 34 }, 1400);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    assert.equal(third.count, 3);
    // App consumes the completed triple and resets before accepting a new one.
    assert.equal(nextClickSequence(EMPTY_CLICK_SEQUENCE, { column: 18, row: 34 }, 1800).count, 1);
  });
});
