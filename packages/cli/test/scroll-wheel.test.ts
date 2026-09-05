/**
 * Wheel-sized scrolling through the transcript viewport reducer.
 *
 * The reducer is where a wheel notch turns into a new offset, so it is where a
 * regression in scroll feel is catchable without a terminal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialViewport, viewportReducer } from '../src/transcript/scroll.js';

const metrics = { contentLines: 500, height: 40 };
const open = viewportReducer(initialViewport, { type: 'open', ...metrics });
/** `open` lands at the tail; start from the top for predictable arithmetic. */
const top = viewportReducer(open, { type: 'home', ...metrics });

describe('line scrolling', () => {
  it('moves one line for an arrow key', () => {
    assert.equal(viewportReducer(top, { type: 'line', delta: 1, ...metrics }).offset, 1);
  });

  it('moves a whole notch at once, which an arrow key could not express', () => {
    // The reason the delta stopped being -1 | 1: a wheel notch is three lines,
    // and one line per notch is what made a long transcript unusable.
    assert.equal(viewportReducer(top, { type: 'line', delta: 3, ...metrics }).offset, 3);
    assert.equal(viewportReducer(top, { type: 'line', delta: 30, ...metrics }).offset, 30);
  });

  it('never scrolls above the first line', () => {
    assert.equal(viewportReducer(top, { type: 'line', delta: -30, ...metrics }).offset, 0);
  });

  it('never scrolls past the last screenful', () => {
    const end = metrics.contentLines - metrics.height;
    assert.equal(viewportReducer(top, { type: 'line', delta: 10_000, ...metrics }).offset, end);
  });

  it('re-arms following once a scroll lands back at the tail', () => {
    // Following is what makes new output appear without a keypress; a wheel
    // that reaches the bottom has to restore it or the transcript freezes.
    const scrolledUp = viewportReducer(open, { type: 'line', delta: -30, ...metrics });
    assert.equal(scrolledUp.follow, false);
    const backDown = viewportReducer(scrolledUp, { type: 'line', delta: 30, ...metrics });
    assert.equal(backDown.follow, true);
  });

  it('keeps a scrolled-away reader in place when new content arrives', () => {
    const scrolledUp = viewportReducer(open, { type: 'line', delta: -30, ...metrics });
    const grown = { contentLines: metrics.contentLines + 50, height: metrics.height };
    assert.equal(viewportReducer(scrolledUp, { type: 'content', ...grown }).offset, scrolledUp.offset);
  });

  it('follows the tail when content arrives and the reader is at the bottom', () => {
    const grown = { contentLines: metrics.contentLines + 50, height: metrics.height };
    const followed = viewportReducer(open, { type: 'content', ...grown });
    assert.equal(followed.offset, grown.contentLines - grown.height);
  });

  it('truncates a fractional delta rather than producing a fractional offset', () => {
    assert.equal(viewportReducer(top, { type: 'line', delta: 3.7, ...metrics }).offset, 3);
  });
});
