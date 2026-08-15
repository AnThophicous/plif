/**
 * The live thinking window.
 *
 * Reasoning is shown while it is being written and folded away the moment it
 * settles. Two properties make that safe to put in the frame: the window is
 * bounded, so a model that thinks for a page cannot push the frame to terminal
 * height; and it is wrapped from the start, so rows hold still as text arrives
 * instead of reflowing on every delta.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { entry } from '../src/session.js';
import { LIVE_THOUGHT_LINES, estimateHeight, thoughtLines, wrappedThoughtLines } from '../src/components/Timeline.js';
import { bloomFrameAt, workingFacts } from '../src/components/Spinner.js';
import { supportsRichGlyphs, workedSeparator } from '../src/theme.js';

const WIDTH = 40;

describe('thoughtLines', () => {
  it('is empty until there is something to show', () => {
    assert.deepEqual(thoughtLines('', WIDTH), []);
    assert.deepEqual(thoughtLines('   \n\n  ', WIDTH), []);
  });

  it('never returns more rows than the window', () => {
    const long = Array.from({ length: 400 }, (_, index) => `word${index}`).join(' ');
    assert.equal(thoughtLines(long, WIDTH).length, LIVE_THOUGHT_LINES);
  });

  it('keeps every row inside the width', () => {
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    for (const line of thoughtLines(long, WIDTH)) {
      assert.ok(line.length <= WIDTH, `"${line}" is ${line.length} wide, over ${WIDTH}`);
    }
  });

  it('breaks a word that cannot fit rather than overflowing', () => {
    const [line] = thoughtLines('x'.repeat(120), WIDTH);
    assert.ok(line !== undefined && line.length <= WIDTH);
  });

  it('shows the end of the thought, which is where it is still being written', () => {
    const rows = thoughtLines('alpha beta gamma delta epsilon zeta eta theta iota', 12);
    assert.equal(rows.at(-1)?.includes('iota'), true);
  });

  it('holds earlier rows still as the thought grows', () => {
    const before = thoughtLines('one two three four five six seven eight', WIDTH);
    const after = thoughtLines('one two three four five six seven eight nine', WIDTH);
    assert.equal(after[0], before[0]);
  });

  it('flattens the newlines a stream sprinkles through reasoning', () => {
    assert.deepEqual(thoughtLines('first\n\nsecond\nthird', WIDTH), ['first second third']);
  });

  it('wraps settled thoughts while retaining paragraph breaks', () => {
    assert.deepEqual(wrappedThoughtLines('first paragraph\nsecond paragraph', 10), [
      'first',
      'paragraph',
      'second',
      'paragraph',
    ]);
  });
});

describe('the height a thinking row claims', () => {
  const thinking = (detail: string, status?: 'active') =>
    entry('thinking', 'Thinking', { detail, ...(status ? { status } : {}) });

  it('is one line once it has settled', () => {
    assert.equal(estimateHeight(thinking('a page of reasoning '.repeat(50)), WIDTH), 1);
  });

  it('is one line while active with nothing written yet', () => {
    assert.equal(estimateHeight(thinking('', 'active'), WIDTH), 1);
  });

  it('accounts for the live window while active, and is bounded by it', () => {
    const height = estimateHeight(thinking('a page of reasoning '.repeat(50), 'active'), WIDTH);
    assert.equal(height, 1 + LIVE_THOUGHT_LINES);
  });
});

describe('cycle separator', () => {
  it('shows a readable, width-aware worked duration', () => {
    const separator = workedSeparator(145_000, 60);
    assert.match(separator, /Worked for 2m 25s/);
    assert.ok(separator.length <= 60);
    assert.equal(estimateHeight(entry('separator', 'Worked', { durationMs: 145_000 }), 60), 2);
  });

  it('normalizes a rounded minute instead of showing sixty seconds', () => {
    assert.match(workedSeparator(59_950, 60), /Worked for 1m 00s/);
  });
});

describe('working bloom', () => {
  it('starts as a ball and opens into a flower', () => {
    assert.equal(bloomFrameAt(0), supportsRichGlyphs ? '●' : 'o');
    assert.notEqual(bloomFrameAt(0), bloomFrameAt(3));
    assert.match(bloomFrameAt(5), /^[+*#]$/);
  });

  it('does not animate Plif working text from the colour clock', () => {
    assert.deepEqual(workingFacts(0, 0, false, true), []);
    assert.deepEqual(workingFacts(180, 0, false, true), []);
    assert.deepEqual(workingFacts(900, 1200, true, true), workingFacts(12_000, 1200, true, true));
    assert.notDeepEqual(workingFacts(900, 0), workingFacts(12_000, 0));
  });
});
