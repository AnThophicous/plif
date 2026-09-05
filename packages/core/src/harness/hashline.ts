import { createHash } from 'node:crypto';

/** A compact, content-bound edit format.  Line numbers alone are stale the
 * moment another actor writes the file; the tag makes that race a refusal. */
export function hashlineTag(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex').slice(0, 4).toUpperCase();
}

export interface HashlineEdit { readonly path: string; readonly tag: string; readonly operations: readonly HashlineOperation[]; }
export type HashlineOperation =
  | { readonly kind: 'swap'; readonly first: number; readonly last: number; readonly lines: readonly string[] }
  | { readonly kind: 'cut'; readonly first: number; readonly last: number }
  | { readonly kind: 'insert'; readonly where: 'pre' | 'post' | 'head' | 'tail'; readonly line?: number; readonly lines: readonly string[] };

/** Parses the safe subset that covers replace, delete and insertion. */
export function parseHashline(input: string): HashlineEdit {
  const rows = input.replace(/\r\n/g, '\n').split('\n');
  const header = /^\[([^#\]]+)#([0-9A-Fa-f]{4})\]$/.exec(rows.shift() ?? '');
  if (!header) throw new Error('hashline must begin [PATH#TAG] from read_file');
  const operations: HashlineOperation[] = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index++]!;
    if (!row.trim()) continue;
    const swap = /^SWAP (\d+)(?:\.=?(\d+))?:$/.exec(row);
    const cut = /^CUT (\d+)(?:\.=?(\d+))?$/.exec(row);
    const insert = /^INS\.(PRE|POST) (\d+):$/.exec(row) ?? /^INS\.(HEAD|TAIL):$/.exec(row);
    if (swap || insert) {
      const lines: string[] = [];
      while (index < rows.length && rows[index]!.startsWith('+')) lines.push(rows[index++]!.slice(1));
      if (lines.length === 0) throw new Error(`${row} needs one or more + body rows`);
      if (swap) operations.push({ kind: 'swap', first: Number(swap[1]), last: Number(swap[2] ?? swap[1]), lines });
      else {
        const mode = insert![1]!.toLowerCase();
        operations.push({ kind: 'insert', where: mode === 'pre' ? 'pre' : mode === 'post' ? 'post' : mode === 'head' ? 'head' : 'tail', ...(insert![2] ? { line: Number(insert![2]) } : {}), lines });
      }
    } else if (cut) operations.push({ kind: 'cut', first: Number(cut[1]), last: Number(cut[2] ?? cut[1]) });
    else throw new Error(`invalid hashline operation: ${row}`);
  }
  if (!operations.length) throw new Error('hashline contains no operations');
  return { path: header[1]!, tag: header[2]!.toUpperCase(), operations };
}

export function applyHashline(content: string, edit: HashlineEdit): string {
  if (hashlineTag(content) !== edit.tag) throw new Error(`stale snapshot: expected ${edit.tag}, current ${hashlineTag(content)}; read the file again`);
  const finalNewline = content.endsWith('\n');
  const lines = content.replace(/\r\n/g, '\n').split('\n'); if (finalNewline) lines.pop();
  const resolved = edit.operations.map((op) => ({ ...op, first: op.kind === 'insert' ? (op.line ?? 0) : op.first, last: op.kind === 'insert' ? (op.line ?? 0) : op.last }));
  for (const op of resolved) if (op.first < 0 || op.last < op.first || op.last > lines.length) throw new Error(`line anchor out of range: ${op.first}`);
  for (const op of [...resolved].sort((a,b) => b.first - a.first)) {
    if (op.kind === 'swap') lines.splice(op.first - 1, op.last - op.first + 1, ...op.lines);
    else if (op.kind === 'cut') lines.splice(op.first - 1, op.last - op.first + 1);
    else if (op.where === 'head') lines.unshift(...op.lines);
    else if (op.where === 'tail') lines.push(...op.lines);
    else lines.splice(op.where === 'pre' ? op.first - 1 : op.first, 0, ...op.lines);
  }
  return lines.join('\n') + (finalNewline ? '\n' : '');
}
