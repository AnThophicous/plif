import type { TranscriptCell } from './transcript/types.js';

export interface ThoughtBlock {
  readonly id: string;
  readonly turnId: string;
  readonly at: string;
  readonly text: string;
  readonly live: boolean;
}

export interface ThinkingLine {
  readonly kind: 'heading' | 'text' | 'blank';
  readonly text: string;
  readonly block: number;
}

export interface ThinkingDocument {
  readonly blocks: readonly ThoughtBlock[];
  readonly lines: readonly ThinkingLine[];
  readonly blockStarts: readonly number[];
}

export const emptyThinkingDocument: ThinkingDocument = {
  blocks: [],
  lines: [],
  blockStarts: [],
};

export function thoughtBlocks(cells: readonly TranscriptCell[]): readonly ThoughtBlock[] {
  return cells.flatMap((cell) =>
    cell.kind === 'reasoning' && cell.text.trim()
      ? [{
          id: cell.id,
          turnId: cell.turnId,
          at: cell.at,
          text: cell.text.trim(),
          live: !cell.finalized,
        }]
      : [],
  );
}

export function thoughtClock(at: string): string {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function wrapThought(text: string, width: number): readonly string[] {
  const columns = Math.max(8, Math.floor(width));
  const rows: string[] = [];

  for (const source of text.split(/\r?\n/)) {
    const flat = source.replace(/[ \t]+/g, ' ').trim();
    if (!flat) {
      if (rows.at(-1) !== '') rows.push('');
      continue;
    }
    let row = '';
    for (const word of flat.split(' ')) {
      for (let at = 0; at < word.length || at === 0; at += columns) {
        const piece = word.slice(at, at + columns);
        if (!row) row = piece;
        else if (row.length + 1 + piece.length <= columns) row += ` ${piece}`;
        else {
          rows.push(row);
          row = piece;
        }
      }
    }
    if (row) rows.push(row);
  }

  while (rows.at(-1) === '') rows.pop();
  return rows;
}

export function thinkingDocument(
  blocks: readonly ThoughtBlock[],
  width: number,
): ThinkingDocument {
  const lines: ThinkingLine[] = [];
  const blockStarts: number[] = [];

  blocks.forEach((block, index) => {
    if (index > 0) lines.push({ kind: 'blank', text: '', block: index });
    blockStarts.push(lines.length);
    const clock = thoughtClock(block.at);
    const heading = [
      `${index + 1}/${blocks.length}`,
      clock,
      block.live ? 'thinking…' : '',
    ].filter(Boolean).join('  ');
    lines.push({ kind: 'heading', text: heading, block: index });
    for (const row of wrapThought(block.text, width)) {
      lines.push({ kind: 'text', text: row, block: index });
    }
  });

  return { blocks, lines, blockStarts };
}

export function blockAtLine(document: ThinkingDocument, offset: number): number {
  let found = 0;
  document.blockStarts.forEach((start, index) => {
    if (start <= offset) found = index;
  });
  return found;
}

export function blockJumpOffset(
  document: ThinkingDocument,
  offset: number,
  delta: -1 | 1,
): number {
  const starts = document.blockStarts;
  if (starts.length === 0) return 0;
  const current = blockAtLine(document, offset);
  const atStart = starts[current] === offset;
  const target = delta === 1
    ? current + 1
    : atStart
      ? current - 1
      : current;
  const clamped = Math.max(0, Math.min(starts.length - 1, target));
  return starts[clamped] ?? 0;
}
