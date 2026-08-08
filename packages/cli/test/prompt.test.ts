/**
 * Horizontal windowing in the prompt.
 *
 * The property under test is simple to state and easy to break: **the cursor is
 * always visible, and the window never exceeds the space available.** Failing
 * the first means typing off the edge of a field you cannot see; failing the
 * second means the box wraps to a second line, the badge lands in the middle of
 * the text, and the frame shifts under the user mid-keystroke.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { windowAround } from '../src/components/Prompt.js';

describe('windowAround', () => {
  it('leaves short input untouched', () => {
    const result = windowAround('npm test', 8, 40);
    assert.equal(result.text, 'npm test');
    assert.equal(result.offset, 0);
    assert.equal(result.clippedLeft, false);
    assert.equal(result.clippedRight, false);
  });

  it('keeps the window within the space available', () => {
    const long = 'x'.repeat(200);
    for (const available of [8, 12, 20, 40]) {
      const result = windowAround(long, 150, available);
      assert.ok(
        result.text.length <= available,
        `window of ${result.text.length} exceeds ${available}`,
      );
    }
  });

  it('keeps the cursor inside the window while typing at the end', () => {
    const value = 'git commit -m "a fairly long commit message goes here"';
    const result = windowAround(value, value.length, 20);
    const cursorInWindow = value.length - result.offset;

    assert.ok(cursorInWindow >= 0, 'cursor scrolled off the left');
    assert.ok(cursorInWindow <= result.text.length, 'cursor scrolled off the right');
    assert.equal(result.clippedLeft, true);
  });

  it('scrolls back when the cursor moves left out of view', () => {
    const value = 'y'.repeat(100);
    const atEnd = windowAround(value, 100, 20);
    const atStart = windowAround(value, 0, 20);

    assert.ok(atStart.offset < atEnd.offset, 'window did not follow the cursor left');
    assert.equal(atStart.offset, 0);
    assert.equal(atStart.clippedLeft, false);
    assert.equal(atStart.clippedRight, true);
  });

  it('anchors the tail flush right rather than scrolling past the end', () => {
    // A window that can scroll past the end leaves blank space on the right
    // while text is still hidden on the left, which looks like a rendering bug.
    const value = 'z'.repeat(50);
    const result = windowAround(value, 49, 20);
    assert.equal(result.offset + result.text.length, value.length);
    assert.equal(result.clippedRight, false);
  });

  it('reports clipping on both sides when the cursor is in the middle', () => {
    const value = 'w'.repeat(100);
    const result = windowAround(value, 50, 20);
    assert.equal(result.clippedLeft, true);
    assert.equal(result.clippedRight, true);
  });

  it('survives an absurdly small field without throwing or going negative', () => {
    const result = windowAround('some text here', 10, 1);
    assert.ok(result.text.length > 0);
    assert.ok(result.offset >= 0);
  });
});
