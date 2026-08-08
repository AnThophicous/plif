/**
 * The line diff behind `edit_file`.
 *
 * Correctness here is load-bearing in a way it usually is not for a display
 * concern: the diff is the only report the developer gets of what an agent
 * changed. A diff that under-reports is a change nobody reviewed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeStats,
  diffLines,
  diffStats,
  formatDiff,
  hunksOf,
  parseDiff,
} from '../src/harness/diff.js';

describe('diffLines', () => {
  it('finds a single changed line in a long file', () => {
    const before = Array.from({ length: 50 }, (_, index) => `line ${index}`).join('\n');
    const after = before.replace('line 25', 'line twenty-five');
    const stats = diffStats(diffLines(before, after));
    assert.deepEqual(stats, { added: 1, removed: 1 });
  });

  it('reports an insertion as added only', () => {
    const stats = diffStats(diffLines('a\nb\nc', 'a\nb\nnew\nc'));
    assert.deepEqual(stats, { added: 1, removed: 0 });
  });

  it('reports a deletion as removed only', () => {
    const stats = diffStats(diffLines('a\nb\nc', 'a\nc'));
    assert.deepEqual(stats, { added: 0, removed: 1 });
  });

  it('treats a new file as all additions', () => {
    const stats = diffStats(diffLines('', 'one\ntwo'));
    assert.equal(stats.removed, 0);
    assert.ok(stats.added >= 2);
  });

  it('sees no change when only the line endings differ', () => {
    // On Windows this is the common case, not an edge one: a file rewritten
    // with CRLF would otherwise diff as every single line changed.
    const stats = diffStats(diffLines('a\r\nb\r\nc', 'a\nb\nc'));
    assert.deepEqual(stats, { added: 0, removed: 0 });
  });

  it('numbers lines against the real files', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    const removed = lines.find((line) => line.op === 'remove');
    const added = lines.find((line) => line.op === 'add');
    assert.equal(removed?.before, 2);
    assert.equal(removed?.after, null);
    assert.equal(added?.after, 2);
    assert.equal(added?.before, null);
  });
});

describe('hunksOf', () => {
  it('collapses the unchanged stretch between two distant changes', () => {
    const before = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');
    const after = before.replace('line 5', 'FIVE').replace('line 80', 'EIGHTY');
    const hunks = hunksOf(diffLines(before, after));
    assert.equal(hunks.length, 2);
    // Three lines of context either side of each change, not ninety.
    for (const hunk of hunks) assert.ok(hunk.lines.length <= 10);
  });

  it('merges changes that are close enough to share context', () => {
    const hunks = hunksOf(diffLines('a\nb\nc\nd', 'A\nb\nc\nD'));
    assert.equal(hunks.length, 1);
  });

  it('returns nothing for an unchanged file', () => {
    assert.deepEqual(hunksOf(diffLines('same', 'same')), []);
  });
});

describe('formatDiff and parseDiff', () => {
  it('round-trips through the unified format', () => {
    const before = 'one\ntwo\nthree\nfour\nfive';
    const after = 'one\nTWO\nthree\nfour\nfive';
    const original = diffLines(before, after);
    const reparsed = parseDiff(formatDiff('a.ts', original));

    assert.deepEqual(diffStats(reparsed), diffStats(original));
    // Line numbers have to survive: the renderer shows them as the file's own,
    // and an off-by-one there sends a reviewer to the wrong line.
    const added = reparsed.find((line) => line.op === 'add');
    assert.equal(added?.after, 2);
    assert.equal(added?.text, 'TWO');
  });

  it('emits nothing at all when nothing changed', () => {
    assert.equal(formatDiff('a.ts', diffLines('same', 'same')), '');
  });

  it('survives content that looks like diff syntax', () => {
    // A file whose own lines start with + or - must not be misparsed as
    // markers when it is read back.
    const before = 'x';
    const after = '+ not a marker\n- also not\nx';
    const reparsed = parseDiff(formatDiff('a.md', diffLines(before, after)));
    assert.ok(reparsed.some((line) => line.op === 'add' && line.text === '+ not a marker'));
  });
});

describe('describeStats', () => {
  it('reads the way the header does', () => {
    assert.equal(describeStats({ added: 9, removed: 1 }), 'Added 9 lines, removed 1 line');
    assert.equal(describeStats({ added: 1, removed: 0 }), 'Added 1 line');
    assert.equal(describeStats({ added: 0, removed: 3 }), 'Removed 3 lines');
  });

  it('is null when there is nothing to say', () => {
    assert.equal(describeStats({ added: 0, removed: 0 }), null);
  });
});
