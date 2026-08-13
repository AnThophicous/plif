/**
 * Moving a cursor through text that contains emoji.
 *
 * The bug these prevent was visible on the very first render of the `:name:`
 * picker: inserting `😭` and placing the cursor one *code unit* later put it
 * between the halves of a surrogate pair, and the terminal drew `��`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clusterAt, clusterLength, displayWidth, snap, stepLeft, stepRight } from '../src/text.js';

const SOB = '😭'; // one pair, 2 units
const DEV = '🧑‍💻'; // person + ZWJ + laptop, 5 units
const FLAG = '⚠️'; // sign + variation selector, 2 units

describe('clusterLength', () => {
  it('counts a plain character as one unit', () => {
    assert.equal(clusterLength('abc', 0), 1);
  });

  it('counts a surrogate pair as one character', () => {
    assert.equal(clusterLength(SOB, 0), 2);
  });

  it('keeps a joined sequence together', () => {
    // Five code units, one thing on screen. Stepping through it a unit at a
    // time would show a person, then a fragment, then a laptop.
    assert.equal(clusterLength(DEV, 0), DEV.length);
  });

  it('absorbs a variation selector', () => {
    assert.equal(clusterLength(FLAG, 0), FLAG.length);
  });

  it('is zero past the end', () => {
    assert.equal(clusterLength('a', 1), 0);
  });
});

describe('stepping', () => {
  it('crosses an emoji in one press', () => {
    const line = `a${SOB}b`;
    assert.equal(stepRight(line, 1), 3);
    assert.equal(stepLeft(line, 3), 1);
  });

  it('crosses a joined sequence in one press', () => {
    const line = `x${DEV}y`;
    const afterEmoji = 1 + DEV.length;
    assert.equal(stepRight(line, 1), afterEmoji);
    assert.equal(stepLeft(line, afterEmoji), 1);
  });

  it('clamps at both ends', () => {
    assert.equal(stepLeft('abc', 0), 0);
    assert.equal(stepRight('abc', 3), 3);
  });

  it('round-trips across a whole line', () => {
    const line = `oi ${SOB} tudo ${DEV} bem ${FLAG}`;
    let at = 0;
    const stops: number[] = [0];
    while (at < line.length) {
      at = stepRight(line, at);
      stops.push(at);
    }
    // Walking back must visit exactly the same boundaries.
    const back: number[] = [line.length];
    while (at > 0) {
      at = stepLeft(line, at);
      back.push(at);
    }
    assert.deepEqual(back.reverse(), stops);
  });
});

describe('snap and clusterAt', () => {
  it('pulls an index out of the middle of a pair', () => {
    const line = `a${SOB}`;
    assert.equal(snap(line, 2), 1);
  });

  it('leaves an index that is already a boundary', () => {
    const line = `a${SOB}b`;
    assert.equal(snap(line, 1), 1);
    assert.equal(snap(line, 3), 3);
  });

  it('hands back the whole glyph under the cursor', () => {
    assert.equal(clusterAt(`a${SOB}b`, 1), SOB);
    assert.equal(clusterAt(`x${DEV}`, 1), DEV);
  });

  it('hands back a space past the end, for the block cursor', () => {
    assert.equal(clusterAt('a', 1), ' ');
  });
});

describe('displayWidth', () => {
  it('counts an emoji as the two cells a terminal gives it', () => {
    assert.equal(displayWidth('ab'), 2);
    assert.equal(displayWidth(SOB), 2);
  });

  it('does not double-count a combining mark', () => {
    assert.equal(displayWidth(FLAG), 2);
  });

  it('is plain length for plain text', () => {
    assert.equal(displayWidth('hello world'), 11);
  });
});

describe('width of characters a terminal draws as emoji', () => {
  it('counts a default-emoji character as the two cells it occupies', () => {
    // Missed by the hand-written astral ranges: these all live in the BMP, and
    // counting them as one cell is a column of misalignment per occurrence.
    for (const glyph of ['⌛', '✅', '⭐', '⛔', '❌']) {
      assert.equal(displayWidth(glyph), 2, `${glyph} should measure two cells`);
    }
  });

  it('leaves the box-drawing and geometric marks the interface is built from', () => {
    for (const glyph of ['●', '•', '▌', '◆', '▸', '✦', '✓', '✗', '│', '└', '█', '░']) {
      assert.equal(displayWidth(glyph), 1, `${glyph} should measure one cell`);
    }
  });

  it('still honours an explicit variation selector', () => {
    assert.equal(displayWidth('⚠'), 1);
    assert.equal(displayWidth('⚠️'), 2);
  });
});
