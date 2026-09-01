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

/**
 * Word-wise cursor movement.
 *
 * A word boundary here is the transition between "characters a word is made
 * of" and everything else, which is what Ctrl+Arrow means in every editor a
 * developer already uses. Punctuation is not part of a word, so `foo.bar()`
 * is four stops rather than one — the same behaviour as a browser input.
 *
 * Movement is still cluster-safe: the boundary search walks whole characters,
 * so a word ending in an emoji cannot leave the cursor inside a surrogate pair.
 */
function isWordCharacter(value: string): boolean {
  return /[\p{Letter}\p{Number}_]/u.test(value);
}

/** Start of the word at or before the cursor. */
export function wordLeft(value: string, cursor: number): number {
  let at = Math.max(0, Math.min(cursor, value.length));
  // Skip whatever separates this position from the previous word.
  while (at > 0) {
    const previous = stepLeft(value, at);
    if (isWordCharacter(clusterAt(value, previous))) break;
    at = previous;
  }
  while (at > 0) {
    const previous = stepLeft(value, at);
    if (!isWordCharacter(clusterAt(value, previous))) break;
    at = previous;
  }
  return at;
}

/** End of the word at or after the cursor. */
export function wordRight(value: string, cursor: number): number {
  let at = Math.max(0, Math.min(cursor, value.length));
  while (at < value.length && !isWordCharacter(clusterAt(value, at))) {
    at = stepRight(value, at);
  }
  while (at < value.length && isWordCharacter(clusterAt(value, at))) {
    at = stepRight(value, at);
  }
  return at;
}

const NEWLINE = String.fromCharCode(10);

/** Start of the line the cursor is on, for Home. */
export function lineStart(value: string, cursor: number): number {
  const at = Math.max(0, Math.min(cursor, value.length));
  const newline = value.lastIndexOf(NEWLINE, Math.max(0, at - 1));
  return newline === -1 ? 0 : newline + 1;
}

/** End of the line the cursor is on, for End. */
export function lineEnd(value: string, cursor: number): number {
  const at = Math.max(0, Math.min(cursor, value.length));
  const newline = value.indexOf(NEWLINE, at);
  return newline === -1 ? value.length : newline;
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
    width += isWide(base) || forcedEmoji || EMOJI_PRESENTATION.test(cluster) ? 2 : 1;
    at += length;
  }

  return width;
}

/**
 * Wrap terminal text without throwing away a byte, a space, or a Unicode
 * grapheme. Code previews use this instead of truncation: a continuation row
 * is less pretty than a single line, but it is still the file the model wrote.
 */
export function wrapTerminalText(value: string, maxWidth: number): string[] {
  const width = Math.max(1, Math.floor(maxWidth));
  const rows: string[] = [];
  for (const source of value.replace(/\r\n?/g, '\n').split('\n')) {
    if (source.length === 0) {
      rows.push('');
      continue;
    }
    let row = '';
    let cells = 0;
    for (let at = 0; at < source.length;) {
      const length = clusterLength(source, at) || 1;
      const cluster = source.slice(at, at + length);
      const clusterCells = Math.max(1, displayWidth(cluster));
      if (row && cells + clusterCells > width) {
        rows.push(row);
        row = '';
        cells = 0;
      }
      row += cluster;
      cells += clusterCells;
      at += length;
    }
    rows.push(row);
  }
  return rows.length > 0 ? rows : [''];
}

/**
 * Characters a terminal draws two cells wide because they are emoji by default.
 *
 * Asked of Unicode rather than listed by hand. The hand-written ranges below
 * cover the astral emoji planes and miss every emoji-presentation codepoint in
 * the BMP — `⌛`, `✅`, `⭐` and a few dozen more — each of which is counted as
 * one cell and drawn as two, which is a column of misalignment per occurrence.
 */
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;

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
