/**
 * Makes Slate's grapheme measurement cheap enough to animate against.
 *
 * `segmentGraphemes` builds a fresh `Intl.Segmenter` on every call, and Slate
 * calls it for each text node on each layout pass of each frame. Profiling a
 * Plif session with an almost empty screen put that one function at ~40% of
 * process CPU; with a few hundred transcript rows on screen the frame stopped
 * being ready in time and the 120 ms animation clock lost more than half its
 * ticks. That is what "the animations do not work" actually was.
 *
 * Two changes, both behaviour-preserving: the Segmenter is built once, and
 * printable-ASCII text — which is nearly all terminal text — skips segmentation
 * entirely, since there every code unit is its own one-cell grapheme.
 * `displayWidth` also memoises, because the same strings are measured every
 * frame. Measured on 8000 calls over typical rows: 107ms -> 1.3ms.
 *
 *   rows on screen   before            after
 *   600              11/25 frames      25/25 frames
 *   1200              7/25 frames      25/25 frames
 *
 * This is a local patch against @slate-terminal 2.2.0, not a fork. It belongs
 * upstream in Slate; once a release carries the fix, the guard below stops
 * matching and this script becomes a no-op that can be deleted.
 *
 * Runs from `postinstall`. It rewrites files under node_modules in place and
 * is safe to run repeatedly.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The shared preamble, inserted once per patched file. */
const PREAMBLE = `/** Patched by plif: see scripts/patch-slate-text.mjs. */
const SLATE_ASCII_ONLY = /^[\\x20-\\x7e]*$/;
const slateSharedSegmenter = Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const slateWidthCache = new Map();
const SLATE_WIDTH_CACHE_LIMIT = 20000;
`;

const WIDTH_BODY = (name) => `${name} displayWidth(value) {
    const cached = slateWidthCache.get(value);
    if (cached !== undefined)
        return cached;
    const width = SLATE_ASCII_ONLY.test(value)
        ? value.length
        : segmentGraphemes(value).reduce((total, grapheme) => total + graphemeWidth(grapheme), 0);
    if (slateWidthCache.size < SLATE_WIDTH_CACHE_LIMIT)
        slateWidthCache.set(value, width);
    return width;
}`;

const WIDTH_ORIGINAL = (name) => `${name} displayWidth(value) {
    return segmentGraphemes(value).reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}`;

/** Each target names the exact original text it replaces, so a changed upstream is left alone. */
const targets = [
  {
    file: 'node_modules/@slate-terminal/react/dist/text.js',
    edits: [
      {
        from: `export function segmentGraphemes(value) {
    const Segmenter = Intl.Segmenter;
    if (Segmenter)
        return [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(item => item.segment);
    return fallbackGraphemes(value);
}`,
        to: `${PREAMBLE}export function segmentGraphemes(value) {
    if (SLATE_ASCII_ONLY.test(value))
        return value.split("");
    if (slateSharedSegmenter)
        return [...slateSharedSegmenter.segment(value)].map(item => item.segment);
    return fallbackGraphemes(value);
}`,
      },
      { from: WIDTH_ORIGINAL('export function'), to: WIDTH_BODY('export function') },
    ],
  },
  {
    file: 'node_modules/@slate-terminal/core/dist/index.js',
    edits: [
      {
        from: `function segmentGraphemes(value) {
    const Segmenter = Intl.Segmenter;
    return Segmenter ? [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(item => item.segment) : [...value];
}`,
        to: `${PREAMBLE}function segmentGraphemes(value) {
    if (SLATE_ASCII_ONLY.test(value))
        return value.split("");
    return slateSharedSegmenter
        ? [...slateSharedSegmenter.segment(value)].map(item => item.segment)
        : [...value];
}`,
      },
      { from: WIDTH_ORIGINAL('function'), to: WIDTH_BODY('function') },
    ],
  },
];

let patched = 0;
let already = 0;
let missing = 0;

for (const target of targets) {
  const file = path.join(root, target.file);
  if (!existsSync(file)) {
    missing += 1;
    continue;
  }
  const raw = readFileSync(file, 'utf8');
  if (raw.includes('SLATE_ASCII_ONLY')) {
    already += 1;
    continue;
  }
  // npm ships these files with CRLF endings on Windows. Match against LF and
  // put the original endings back, so the patch applies on either platform and
  // does not rewrite every line of the file as a side effect.
  const crlf = raw.includes('\r\n');
  const before = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  let after = before;
  for (const edit of target.edits) {
    if (!after.includes(edit.from)) {
      after = before;
      break;
    }
    after = after.replace(edit.from, edit.to);
  }
  if (after === before) {
    // Upstream changed shape. Leaving it untouched is the safe answer: the app
    // is slower, not broken, and a blind rewrite here would be worse.
    missing += 1;
    continue;
  }
  writeFileSync(file, crlf ? after.replace(/\n/g, '\r\n') : after);
  patched += 1;
}

if (patched > 0) console.log(`patch-slate-text: patched ${patched} file(s)`);
else if (already > 0 && missing === 0) console.log('patch-slate-text: already applied');
else if (missing > 0) console.log('patch-slate-text: skipped (no matching Slate build found)');
