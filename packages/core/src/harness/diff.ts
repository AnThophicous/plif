/**
 * What an edit actually changed.
 *
 * Every write the agent makes goes through here on its way back to the screen,
 * for a reason that has nothing to do with presentation: **a diff is the only
 * honest report of an edit.** "wrote src/app.tsx (14kb, 402 lines)" is true of
 * a one-word fix and of a file the model silently rewrote from scratch, and by
 * the time the difference matters the context that would have caught it is
 * gone. Showing the changed lines makes the second case impossible to miss.
 *
 * The algorithm is ordinary LCS over lines, with the common prefix and suffix
 * stripped first. That trimming is not an optimisation detail — it is what
 * makes the quadratic core cheap on the real case, where a 4000-line file has
 * six changed lines in the middle and the LCS is run over a handful of rows.
 */

export type DiffOp = 'context' | 'add' | 'remove';

export interface DiffLine {
  readonly op: DiffOp;
  readonly text: string;
  /** 1-based line number in the old file; null on an added line. */
  readonly before: number | null;
  /** 1-based line number in the new file; null on a removed line. */
  readonly after: number | null;
}

export interface DiffHunk {
  readonly beforeStart: number;
  readonly afterStart: number;
  readonly lines: readonly DiffLine[];
}

export interface DiffStats {
  readonly added: number;
  readonly removed: number;
}

/** Context lines kept either side of a change. */
const CONTEXT = 3;

/**
 * Above this, the LCS table is not worth building.
 *
 * Four million cells is roughly a 2000×2000 diff, which is already an edit
 * nobody is reading line by line. Past it the whole changed region is reported
 * as one replacement — still correct, just less precise about which lines
 * inside it moved.
 */
const LCS_CEILING = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  // Split on \n after normalising \r\n. A file that differs only in line
  // endings would otherwise diff as every line changed, which is both useless
  // and alarming — and on Windows it is the common case, not an edge one.
  const oldLines = normalise(before);
  const newLines = normalise(after);

  let head = 0;
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) {
    head += 1;
  }

  let tail = 0;
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) {
    tail += 1;
  }

  const oldMiddle = oldLines.slice(head, oldLines.length - tail);
  const newMiddle = newLines.slice(head, newLines.length - tail);

  const lines: DiffLine[] = [];
  for (let index = 0; index < head; index += 1) {
    lines.push({ op: 'context', text: oldLines[index] as string, before: index + 1, after: index + 1 });
  }

  const middle =
    oldMiddle.length * newMiddle.length > LCS_CEILING
      ? blockReplace(oldMiddle, newMiddle)
      : lcsDiff(oldMiddle, newMiddle);

  let oldAt = head;
  let newAt = head;
  for (const item of middle) {
    if (item.op === 'remove') {
      oldAt += 1;
      lines.push({ op: 'remove', text: item.text, before: oldAt, after: null });
    } else if (item.op === 'add') {
      newAt += 1;
      lines.push({ op: 'add', text: item.text, before: null, after: newAt });
    } else {
      oldAt += 1;
      newAt += 1;
      lines.push({ op: 'context', text: item.text, before: oldAt, after: newAt });
    }
  }

  for (let index = 0; index < tail; index += 1) {
    lines.push({
      op: 'context',
      text: oldLines[oldLines.length - tail + index] as string,
      before: oldLines.length - tail + index + 1,
      after: newLines.length - tail + index + 1,
    });
  }

  return lines;
}

export function diffStats(lines: readonly DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === 'add') added += 1;
    else if (line.op === 'remove') removed += 1;
  }
  return { added, removed };
}

/** "Added 9 lines, removed 1 line", or null when nothing changed. */
export function describeStats(stats: DiffStats): string | null {
  const parts: string[] = [];
  if (stats.added) parts.push(`Added ${stats.added} line${stats.added === 1 ? '' : 's'}`);
  if (stats.removed) {
    parts.push(
      `${parts.length ? 'removed' : 'Removed'} ${stats.removed} line${
        stats.removed === 1 ? '' : 's'
      }`,
    );
  }
  return parts.length ? parts.join(', ') : null;
}

/**
 * Group changes into hunks, dropping the unchanged stretches between them.
 *
 * A whole file with six changed lines in it is not a diff, it is a file. The
 * three lines either side are what let a reader place the change without going
 * back to the source.
 */
export function hunksOf(lines: readonly DiffLine[], context = CONTEXT): DiffHunk[] {
  const interesting = lines
    .map((line, index) => (line.op === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (interesting.length === 0) return [];

  const hunks: DiffHunk[] = [];
  let start = Math.max(0, (interesting[0] as number) - context);
  let end = Math.min(lines.length, (interesting[0] as number) + context + 1);

  for (const index of interesting.slice(1)) {
    if (index - context <= end) {
      end = Math.min(lines.length, index + context + 1);
      continue;
    }
    hunks.push(makeHunk(lines, start, end));
    start = Math.max(0, index - context);
    end = Math.min(lines.length, index + context + 1);
  }
  hunks.push(makeHunk(lines, start, end));
  return hunks;
}

function makeHunk(lines: readonly DiffLine[], start: number, end: number): DiffHunk {
  const slice = lines.slice(start, end);
  const first = slice[0];
  return {
    beforeStart: first?.before ?? first?.after ?? 1,
    afterStart: first?.after ?? first?.before ?? 1,
    lines: slice,
  };
}

/**
 * Unified diff text, for the model.
 *
 * Deliberately the standard format rather than something prettier. Every model
 * has seen millions of unified diffs and none of them have seen ours, and a
 * tool result is read by the model before it is read by anyone else.
 */
export function formatDiff(path: string, lines: readonly DiffLine[], context = CONTEXT): string {
  const hunks = hunksOf(lines, context);
  if (hunks.length === 0) return '';

  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    const beforeCount = hunk.lines.filter((line) => line.op !== 'add').length;
    const afterCount = hunk.lines.filter((line) => line.op !== 'remove').length;
    out.push(`@@ -${hunk.beforeStart},${beforeCount} +${hunk.afterStart},${afterCount} @@`);
    for (const line of hunk.lines) {
      out.push((line.op === 'add' ? '+' : line.op === 'remove' ? '-' : ' ') + line.text);
    }
  }
  return out.join('\n');
}

/**
 * Read a unified diff back into lines.
 *
 * The renderer needs the structure and only has the text: a tool result crosses
 * the event bus as a string, and inventing a second channel for the same
 * information is how the two get out of step.
 */
export function parseDiff(text: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let before = 0;
  let after = 0;

  for (const raw of text.split('\n')) {
    if (raw.startsWith('---') || raw.startsWith('+++')) continue;
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      before = Number(header[1]);
      after = Number(header[2]);
      continue;
    }
    if (raw.startsWith('+')) {
      lines.push({ op: 'add', text: raw.slice(1), before: null, after });
      after += 1;
    } else if (raw.startsWith('-')) {
      lines.push({ op: 'remove', text: raw.slice(1), before, after: null });
      before += 1;
    } else if (raw.startsWith(' ') || raw === '') {
      lines.push({ op: 'context', text: raw.slice(1), before, after });
      before += 1;
      after += 1;
    }
  }
  return lines;
}

function normalise(text: string): string[] {
  // An empty file has no lines, not one empty line. `''.split('\n')` says
  // otherwise, and the difference shows up on the most visible case there is:
  // creating a file reported a removed blank line that never existed.
  if (text === '') return [];
  const normalised = text.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n');
  // A trailing newline is a terminator, not an empty final line. Counting it
  // adds a phantom line to every file written with one — which is every file.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

interface Step {
  readonly op: DiffOp;
  readonly text: string;
}

function blockReplace(oldLines: readonly string[], newLines: readonly string[]): Step[] {
  return [
    ...oldLines.map((text) => ({ op: 'remove' as const, text })),
    ...newLines.map((text) => ({ op: 'add' as const, text })),
  ];
}

function lcsDiff(oldLines: readonly string[], newLines: readonly string[]): Step[] {
  const rows = oldLines.length;
  const columns = newLines.length;

  // table[i][j] = length of the longest common subsequence of the suffixes
  // starting at i and j. Built backwards so the walk forward is a simple
  // greedy read, which is what keeps the output stable and in source order.
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      (table[i] as number[])[j] =
        oldLines[i] === newLines[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (table[i + 1] as number[])[j] as number,
              (table[i] as number[])[j + 1] as number,
            );
    }
  }

  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (oldLines[i] === newLines[j]) {
      steps.push({ op: 'context', text: oldLines[i] as string });
      i += 1;
      j += 1;
    } else if (
      ((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)
    ) {
      steps.push({ op: 'remove', text: oldLines[i] as string });
      i += 1;
    } else {
      steps.push({ op: 'add', text: newLines[j] as string });
      j += 1;
    }
  }
  while (i < rows) {
    steps.push({ op: 'remove', text: oldLines[i] as string });
    i += 1;
  }
  while (j < columns) {
    steps.push({ op: 'add', text: newLines[j] as string });
    j += 1;
  }
  return steps;
}
