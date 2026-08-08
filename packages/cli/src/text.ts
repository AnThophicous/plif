/**
 * Moving through text that contains emoji.
 *
 * JavaScript strings are UTF-16, and every index in the input handling — the
 * cursor, `slice`, `length` — counts code *units*. An emoji is two of them, and
 * some are far more: `🧑‍💻` is a person, a zero-width joiner and a laptop, five
 * units for one thing on screen. Stepping by one unit lands in the middle of a
 * character, and the terminal draws the halves as replacement boxes.
 *
 * That failure is not theoretical. The first render of the `:name:` picker put
 * `😭` in the prompt and drew `��`, because the cursor had been placed
 * between the two halves of the pair.
 *
 * So the input handling moves by *cluster*, not by unit: a base character plus
 * whatever binds to it — a joiner and its partner, a variation selector, a skin
 * tone. Not a complete grapheme implementation, and it does not need to be. It
 * needs to never leave the cursor inside something.
 */

/** Zero-width joiner: binds the parts of `🧑‍💻` into one glyph. */
const ZWJ = 0x200d;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Combining marks that attach to the character before them. */
function isCombining(code: number): boolean {
  return (
    code === ZWJ ||
    code === 0xfe0e ||
    code === 0xfe0f || // variation selectors: text vs emoji presentation
    (code >= 0x1f3fb && code <= 0x1f3ff) || // skin tones
    (code >= 0x20d0 && code <= 0x20ff) || // combining marks for symbols
    (code >= 0x0300 && code <= 0x036f) // combining diacriticals
  );
}

/** Length in code units of the cluster starting at `index`. */
export function clusterLength(value: string, index: number): number {
  if (index >= value.length) return 0;

  let end = index + (isHighSurrogate(value.charCodeAt(index)) ? 2 : 1);

  // Swallow anything that binds to what we just took, and — after a joiner —
  // the character it joins to.
  for (;;) {
    if (end >= value.length) break;
    const code = value.codePointAt(end) as number;
    if (!isCombining(code)) break;
    const wasJoiner = code === ZWJ;
    end += code > 0xffff ? 2 : 1;
    if (wasJoiner && end < value.length) {
      end += isHighSurrogate(value.charCodeAt(end)) ? 2 : 1;
    }
  }

  return end - index;
}

/** The index one whole cluster to the right, clamped to the end. */
export function stepRight(value: string, cursor: number): number {
  if (cursor >= value.length) return value.length;
  return Math.min(value.length, cursor + clusterLength(value, cursor));
}

/** The index one whole cluster to the left, clamped to zero. */
export function stepLeft(value: string, cursor: number): number {
  if (cursor <= 0) return 0;

  // Walk forward from the start: the only reliable way to find the boundary
  // before an arbitrary index, since a cluster is defined left to right.
  let at = 0;
  let previous = 0;
  while (at < cursor && at < value.length) {
    previous = at;
    at += clusterLength(value, at) || 1;
  }
  return at <= cursor ? at === cursor ? previous : at : previous;
}

/** The whole cluster sitting at `index`, or a space past the end. */
export function clusterAt(value: string, index: number): string {
  if (index >= value.length) return ' ';
  const length = clusterLength(value, index);
  return value.slice(index, index + length) || ' ';
}

/** Snap an index onto the nearest cluster boundary at or before it. */
export function snap(value: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= value.length) return value.length;
  let at = 0;
  while (at < value.length) {
    const next = at + (clusterLength(value, at) || 1);
    if (next > index) return at;
    if (next === index) return index;
    at = next;
  }
  return value.length;
}

/**
 * Display width, counting an emoji as the two cells a terminal gives it.
 *
 * Not exact — no lookup table here can be — but wrong in the safe direction for
 * the two things that use it. A width that is too large truncates a line early;
 * one that is too small overflows the terminal, and an over-wide line is what
 * makes Ink's frame erase come up short.
 */
export function displayWidth(value: string): number {
  let width = 0;
  let at = 0;

  while (at < value.length) {
    const length = clusterLength(value, at) || 1;
    const cluster = value.slice(at, at + length);
    const base = cluster.codePointAt(0) as number;
    // The emoji variation selector is what makes a narrow base render wide.
    // `⚠` is one cell; `⚠️` — the same sign plus U+FE0F — is two, and the
    // difference is invisible in the source.
    const forcedEmoji = cluster.includes('️');
    width += isWide(base) || forcedEmoji ? 2 : 1;
    at += length;
  }

  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) || // emoji
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff)
  );
}
