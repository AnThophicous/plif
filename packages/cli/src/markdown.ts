export type SpanStyle = 'plain' | 'bold' | 'italic' | 'code' | 'link' | 'strike';

export interface MdSpan {
  readonly text: string;
  readonly style: SpanStyle;
  readonly strong?: boolean;
}

export type MdBlock =
  | { readonly kind: 'text'; readonly spans: readonly MdSpan[]; readonly indent: number }
  | { readonly kind: 'heading'; readonly level: number; readonly spans: readonly MdSpan[] }
  | {
      readonly kind: 'bullet';
      readonly marker: string;
      readonly spans: readonly MdSpan[];
      readonly indent: number;
    }
  | { readonly kind: 'code'; readonly language: string; readonly lines: readonly string[] }
  | { readonly kind: 'quote'; readonly spans: readonly MdSpan[] }
  | { readonly kind: 'rule' }
  | { readonly kind: 'blank' };

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|~~[^~]+~~|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/;

/**
 * Re-parse the inside of a bold span and carry the emphasis down.
 *
 * `**soma returns `a - b`**` is ordinary phrasing once the prompt tells the
 * agent to bold the cause and backtick the identifiers. Without this the inner
 * backticks survive as literal characters in the middle of a bold sentence,
 * which reads as a rendering bug because it is one.
 */
function nested(inner: string): MdSpan[] {
  return parseInline(inner).map((span) =>
    span.style === 'plain'
      ? { text: span.text, style: 'bold' as SpanStyle }
      : { ...span, strong: true },
  );
}

export function parseInline(source: string): MdSpan[] {
  const spans: MdSpan[] = [];

  for (const piece of source.split(INLINE)) {
    if (!piece) continue;

    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      spans.push(...nested(piece.slice(2, -2)));
    } else if (piece.startsWith('__') && piece.endsWith('__') && piece.length > 4) {
      spans.push(...nested(piece.slice(2, -2)));
    } else if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
      spans.push({ text: piece.slice(1, -1), style: 'code' });
    } else if (piece.startsWith('~~') && piece.endsWith('~~') && piece.length > 4) {
      spans.push({ text: piece.slice(2, -2), style: 'strike' });
    } else if (piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) {
      spans.push({ text: piece.slice(1, -1), style: 'italic' });
    } else if (piece.startsWith('[') && piece.includes('](')) {
      const label = piece.slice(1, piece.indexOf(']('));
      spans.push({ text: label, style: 'link' });
    } else {
      spans.push({ text: piece, style: 'plain' });
    }
  }

  return spans.length > 0 ? spans : [{ text: source, style: 'plain' }];
}

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;

    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', language, lines: body });
      continue;
    }

    if (/^\s*$/.test(line)) {
      blocks.push({ kind: 'blank' });
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] as string).length,
        spans: parseInline(heading[2] as string),
      });
      index += 1;
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({ kind: 'quote', spans: parseInline(quote[1] as string) });
      index += 1;
      continue;
    }

    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      const indent = Math.floor((bullet[1] as string).length / 2);
      const raw = bullet[2] as string;
      blocks.push({
        kind: 'bullet',
        marker: /^\d/.test(raw) ? raw : '·',
        spans: parseInline(bullet[3] as string),
        indent,
      });
      index += 1;
      continue;
    }

    const leading = /^(\s*)/.exec(line)?.[1]?.length ?? 0;
    blocks.push({
      kind: 'text',
      spans: parseInline(line.trim()),
      indent: Math.floor(leading / 2),
    });
    index += 1;
  }

  while (blocks.length > 0 && blocks[blocks.length - 1]?.kind === 'blank') blocks.pop();
  return blocks;
}

export function wrapSpans(
  spans: readonly MdSpan[],
  width: number,
): MdSpan[][] {
  if (width <= 0) return [[...spans]];

  const lines: MdSpan[][] = [];
  let current: MdSpan[] = [];
  let used = 0;

  const flush = (): void => {
    if (current.length > 0) lines.push(current);
    current = [];
    used = 0;
  };

  for (const span of spans) {
    for (const word of span.text.split(/(\s+)/)) {
      if (!word) continue;
      const isSpace = /^\s+$/.test(word);

      if (isSpace) {
        if (used > 0 && used < width) {
          current.push({ text: ' ', style: span.style });
          used += 1;
        }
        continue;
      }

      if (used + word.length > width && used > 0) flush();

      if (word.length > width) {
        let rest = word;
        while (rest.length > width) {
          if (used > 0) flush();
          current.push({ text: rest.slice(0, width), style: span.style });
          used = width;
          flush();
          rest = rest.slice(width);
        }
        if (rest) {
          current.push({ text: rest, style: span.style });
          used += rest.length;
        }
        continue;
      }

      current.push({ text: word, style: span.style });
      used += word.length;
    }
  }

  flush();
  return lines.length > 0 ? lines : [[]];
}

export function plainText(spans: readonly MdSpan[]): string {
  return spans.map((span) => span.text).join('');
}
