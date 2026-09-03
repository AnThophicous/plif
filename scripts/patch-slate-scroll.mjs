/**
 * Keeps non-shrinkable children intact when a line overflows.
 *
 * Slate's flex engine rounds final child sizes through `pixelSizes`, which
 * clamps every child without an explicit `maxHeight` to the line's leftover
 * capacity — `floor(available - margins - gaps)`. A child that cannot shrink
 * (`flexShrink: 0`) is supposed to overflow the line untouched; that is the
 * entire contract a scroll container is built on. Instead, once the content of
 * a ScrollView grew past its viewport — margins included — the ceiling dropped
 * below the children's base sizes and every row in it was clamped to zero.
 *
 * The visible failure: a Plif session rendered fine while the transcript fit
 * the timeline budget, and the moment it exceeded it — a resumed session above
 * all — the whole conversation collapsed to an empty panel. The prompt kept
 * working while everything above it vanished, and each keystroke reflowed the
 * frame as rows silently changed height.
 *
 * One change, behaviour-preserving for every line that fits: children that
 * opted out of shrinking (`flexShrink: 0`) are clamped to their own base size
 * rather than the line's capacity, and they contribute that size to the line's
 * target so the deficit pass cannot grind them back down. Shrinkable children
 * take exactly the same path as before.
 *
 * This is a local patch against @slate-terminal 2.2.0, not a fork. It belongs
 * upstream in Slate; once a release carries the fix, the guard below stops
 * matching and this script becomes a no-op that can be deleted.
 *
 * Runs from `postinstall` (after patch-slate-text.mjs). It rewrites files
 * under node_modules in place and is safe to run repeatedly.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ORIGINAL = `function pixelSizes(values, line, available, gap, margins) {
    const lower = line.map(item => Math.max(0, Math.ceil(item.minMain)));
    const upper = line.map((item, index) => Number.isFinite(item.maxMain) ? Math.max(lower[index] ?? 0, Math.floor(item.maxMain)) : Math.max(lower[index] ?? 0, Math.floor(Math.max(0, available - margins - Math.max(0, line.length - 1) * gap))));
    const capacity = Math.max(0, Math.floor(available - margins - Math.max(0, line.length - 1) * gap));
    const sumLower = lower.reduce((sum, value) => sum + value, 0);
    const target = Math.max(sumLower, Math.min(Math.round(values.reduce((sum, value) => sum + Math.max(0, value), 0)), capacity));`;

const PATCHED = `function pixelSizes(values, line, available, gap, margins) {
    const rigid = line.map((item, index) => (item.shrink ?? 1) === 0 ? Math.max(0, Math.floor(Math.max(0, values[index] ?? 0))) : null);
    const lower = line.map((item, index) => Math.max(rigid[index] ?? 0, Math.ceil(item.minMain)));
    const upper = line.map((item, index) => rigid[index] !== null ? rigid[index] : Number.isFinite(item.maxMain) ? Math.max(lower[index] ?? 0, Math.floor(item.maxMain)) : Math.max(lower[index] ?? 0, Math.floor(Math.max(0, available - margins - Math.max(0, line.length - 1) * gap))));
    const capacity = Math.max(0, Math.floor(available - margins - Math.max(0, line.length - 1) * gap));
    const rigidTotal = rigid.reduce((sum, value) => sum + (value ?? 0), 0);
    const sumLower = lower.reduce((sum, value) => sum + value, 0);
    const target = Math.max(sumLower, rigidTotal, Math.min(Math.round(values.reduce((sum, value) => sum + Math.max(0, value), 0)), Math.max(capacity, rigidTotal)));`;

const targets = [
  path.join(root, 'node_modules', '@slate-terminal', 'react', 'dist', 'flex.js'),
];

let patched = 0;
for (const file of targets) {
  if (!existsSync(file)) continue;
  // Normalise line endings first: earlier local edits may have written CRLF,
  // and the patterns below are LF-joined.
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (source.includes('slateScrollRigidFix')) {
    patched += 1;
    continue;
  }
  if (!source.includes(ORIGINAL)) continue;
  writeFileSync(file, source.replace(ORIGINAL, `/* slateScrollRigidFix: keep flexShrink:0 children at base size on overflow. */\n${PATCHED}`), 'utf8');
  patched += 1;
}

if (patched === 0) {
  console.warn('patch-slate-scroll: nothing matched; either already patched or Slate shipped the fix.');
}
