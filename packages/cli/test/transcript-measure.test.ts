/**
 * Cell height measurement, and the cache in front of it.
 *
 * The overlay asks for every cell's height on every render, so the answer is
 * cached per cell object. A cache that returned a stale height would draw the
 * transcript at the wrong size — a worse failure than the slowness it fixes —
 * so these tests are mostly about the ways it must miss.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { measureTranscriptCell, measureTranscriptCells } from '../src/components/Timeline.js';
import type { TranscriptCell } from '../src/transcript/types.js';

function assistant(id: string, text: string): TranscriptCell {
  return { id, kind: 'assistant', text } as TranscriptCell;
}

describe('transcript measurement', () => {
  it('grows with the text', () => {
    const short = measureTranscriptCell(assistant('a', 'one line'), 80);
    const long = measureTranscriptCell(assistant('b', 'word '.repeat(400)), 80);
    assert.ok(long > short);
  });

  it('grows as the terminal narrows, because the text wraps more', () => {
    const text = 'word '.repeat(200);
    const wide = measureTranscriptCell(assistant('c', text), 200);
    const narrow = measureTranscriptCell(assistant('c2', text), 40);
    assert.ok(narrow > wide, `narrow (${narrow}) should exceed wide (${wide})`);
  });

  it('answers the same cell consistently, which is what makes caching safe', () => {
    const cell = assistant('d', 'word '.repeat(120));
    const first = measureTranscriptCell(cell, 100);
    assert.equal(measureTranscriptCell(cell, 100), first);
    assert.equal(measureTranscriptCell(cell, 100), first);
  });

  it('does not reuse one width answer for another', () => {
    // The cache key carries the width. Dropping it would size every cell by
    // whichever width happened to be asked first.
    const cell = assistant('e', 'word '.repeat(200));
    const wide = measureTranscriptCell(cell, 200);
    const narrow = measureTranscriptCell(cell, 40);
    assert.notEqual(wide, narrow);
    // And back again, from the cache this time.
    assert.equal(measureTranscriptCell(cell, 200), wide);
    assert.equal(measureTranscriptCell(cell, 40), narrow);
  });

  it('measures a new cell object rather than the one it replaced', () => {
    // A streaming cell is rebuilt as text arrives. Each rebuild is a new
    // object, so it must miss the cache and be measured again.
    const growing = 'word '.repeat(50);
    const before = measureTranscriptCell(assistant('f', growing), 80);
    const after = measureTranscriptCell(assistant('f', growing + 'word '.repeat(50)), 80);
    assert.ok(after > before);
  });

  it('sums the cells it is given', () => {
    const cells = [assistant('g', 'a'), assistant('h', 'b'), assistant('i', 'c')];
    const total = measureTranscriptCells(cells, 80);
    const parts = cells.reduce((sum, cell) => sum + measureTranscriptCell(cell, 80), 0);
    assert.equal(total, parts);
  });

  it('distinguishes expanded from collapsed', () => {
    const diff = {
      id: 'j',
      kind: 'diff',
      diff: ['--- a', '+++ b', ...Array.from({ length: 60 }, (_, i) => `+line ${i}`)].join('\n'),
    } as TranscriptCell;
    const collapsed = measureTranscriptCell(diff, 100, false);
    const expanded = measureTranscriptCell(diff, 100, true);
    assert.ok(expanded >= collapsed);
    // Re-asking must not hand the expanded answer back for the collapsed view.
    assert.equal(measureTranscriptCell(diff, 100, false), collapsed);
  });
});
