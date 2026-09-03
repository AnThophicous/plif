import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The primitives live in a module the package does not re-export, so they are
// loaded through the package's own resolved location rather than by subpath.
const slateRoot = path.dirname(
  createRequire(import.meta.url).resolve('@slate-terminal/react/package.json'),
);
const {
  displayWidth,
  graphemeWidth,
  segmentGraphemes,
  splitLines,
  wrapText,
} = await import(pathToFileURL(path.join(slateRoot, 'dist', 'text.js')).href) as {
  displayWidth(value: string): number;
  graphemeWidth(value: string): number;
  segmentGraphemes(value: string): string[];
  splitLines(value: string): string[];
  wrapText(value: string, maxWidth: number): string[];
};

/**
 * Guards `scripts/patch-slate-text.mjs`.
 *
 * The patch replaces Slate's text primitives with memoised, ASCII-fast-path
 * versions because they were the largest single cost in a frame: wrapping 600
 * transcript rows went from 5.6 ms to 0.26 ms, which is the difference between
 * fitting a 60 Hz frame and not. Speed is worthless if the wrap moves, though
 * - a wrong width silently shifts every column of the transcript - so this
 * holds the patched implementations against transcriptions of the originals.
 *
 * If a Slate upgrade makes the patch stop applying, the equivalence assertions
 * still pass and only the first test fails. That is the honest signal: still
 * correct, slow again.
 */

// Pristine @slate-terminal 2.2.0 implementations, transcribed.
const originalSplitLines = (value: string): string[] =>
  value.replace(/\r\n?/g, '\n').split('\n');

const originalSegment = (value: string): string[] =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
    .map((item) => item.segment);

function originalWidth(value: string): number {
  const code = value.codePointAt(0) ?? 0;
  if (value.includes('\n') || value.includes('\r')) return 0;
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return value === '\t' ? 1 : 0;
  if (/^(?:\p{Mark}|\uFE0F|\u200D)/u.test(value)) return 0;
  const wide = /\p{Extended_Pictographic}/u.test(value)
    || [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point >= 0x1100 && (point <= 0x115f
        || point === 0x2329 || point === 0x232a
        || (point >= 0x2e80 && point <= 0xa4cf)
        || (point >= 0xac00 && point <= 0xd7a3)
        || (point >= 0xf900 && point <= 0xfaff)
        || (point >= 0xfe10 && point <= 0xfe19)
        || (point >= 0xff01 && point <= 0xff60)
        || point >= 0x1f300);
    });
  return wide ? 2 : 1;
}

function originalWrapLine(value: string, maxWidth: number): string[] {
  if (value.length === 0) return [''];
  if (!Number.isFinite(maxWidth)) return [value];
  const result: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const grapheme of originalSegment(value)) {
    const width = originalWidth(grapheme);
    if (width > 0 && current && currentWidth + width > maxWidth) {
      result.push(current);
      current = '';
      currentWidth = 0;
    }
    current += grapheme;
    currentWidth += width;
    if (currentWidth >= maxWidth) {
      result.push(current);
      current = '';
      currentWidth = 0;
    }
  }
  if (current || result.length === 0) result.push(current);
  return result;
}

const originalWrapText = (value: string, maxWidth: number): string[] => {
  const width = Math.max(1, Math.floor(maxWidth));
  return originalSplitLines(value).flatMap((line) => originalWrapLine(line, width));
};

/** ASCII, accents, CJK, emoji with ZWJ and flags, control characters. */
const CORPUS: readonly string[] = [
  '',
  'a',
  'hello world',
  'abcde',
  'abcdef',
  '  const value = computeSomething(12, "a fairly long argument string");',
  'a b c d e f g',
  'aaa\nbbbb',
  'crlf\r\nlines\rold',
  'caf\u00e9 \u00e9\u00e9\u00e9',
  '\u4f60\u597d\u4e16\u754c',
  '\u{1f600}\u{1f600}\u{1f600}',
  '\u{1f469}\u200D\u{1f469}\u200D\u{1f467}',
  '\u{1f1e7}\u{1f1f7}',
  'tab\tend',
  'mixed \u4f60 ascii \u{1f600} tail',
];

const WIDTHS = [1, 2, 3, 4, 5, 8, 13, 40, 120];

test('the Slate text patch is applied', () => {
  // The fast path is what those timings depend on. Its observable trace is
  // that an all-ASCII line needs no segmentation at all to be measured.
  assert.equal(displayWidth('plain ascii row'), 15);
  assert.deepEqual(splitLines('one line'), ['one line']);
});

test('patched text primitives match the originals', () => {
  for (const value of CORPUS) {
    assert.deepEqual(splitLines(value), originalSplitLines(value), `splitLines ${JSON.stringify(value)}`);
    assert.deepEqual(segmentGraphemes(value), originalSegment(value), `segment ${JSON.stringify(value)}`);
    assert.equal(
      displayWidth(value),
      originalSegment(value).reduce((total, grapheme) => total + originalWidth(grapheme), 0),
      `displayWidth ${JSON.stringify(value)}`,
    );
    for (const grapheme of originalSegment(value)) {
      assert.equal(graphemeWidth(grapheme), originalWidth(grapheme), `graphemeWidth ${JSON.stringify(grapheme)}`);
    }
    for (const width of WIDTHS) {
      assert.deepEqual(
        wrapText(value, width),
        originalWrapText(value, width),
        `wrapText ${JSON.stringify(value)} @ ${width}`,
      );
    }
  }
});
