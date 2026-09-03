import React from 'react';
import { Box, Text } from '../ui.js';

import { describeStats, diffStats, hunksOf, parseDiff } from '@plif/core';
import type { DiffLine } from '@plif/core';
import { color, diffStyle, glyph, syntaxColor } from '../theme.js';
import { highlight, languageOf } from '../highlight.js';
import { displayWidth, wrapTerminalText } from '../text.js';

interface DiffProps {
  readonly diff: string;
  readonly width: number;
  /** Path the diff belongs to, for choosing the syntax rules. */
  readonly path?: string;
  /** Show every hunk instead of the first few. */
  readonly expand?: boolean;
}

/**
 * Background tints for the two sides.
 *
 * Dark enough to read light text on, and desaturated enough that a screen with
 * forty changed lines does not become a red and green wall. The foreground
 * still carries the syntax colours — the background says which side, the
 * colours say what the code is, and neither has to shout.
 */

/**
 * The gutter and code column widths `Diff` lays each row out with.
 *
 * Shared rather than recomputed, because the one time this lived twice — once
 * here and once, separately, in a row-count estimate — the two drifted apart.
 * The estimate kept assuming a folded, unwrapped diff long after `Diff` was
 * changed to always render every line; the terminal's own erase-by-row-count
 * then came up short against what was actually painted, and old wrapped text
 * was left on screen under the new frame. Every caller that needs to know how
 * tall a diff will be now goes through the same numbers `Diff` renders with.
 */
function diffLayout(lines: readonly DiffLine[], width: number): { gutter: number; codeWidth: number } {
  const gutter = Math.max(
    3,
    String(Math.max(0, ...lines.map((line) => line.after ?? line.before ?? 0))).length,
  );
  return { gutter, codeWidth: Math.max(12, width - gutter - 6) };
}

/**
 * Height in terminal rows, for the caller's layout budget.
 *
 * `Diff` renders every line — nothing is folded — so this has to count the
 * same thing it does: one physical row per wrapped segment of every line, not
 * one row per logical diff line. `width` must be the same value the matching
 * `<Diff>` is given, or the two fall back out of step.
 */
export function diffHeight(diff: string, width: number, expand = false): number {
  const lines = parseDiff(diff);
  if (lines.length === 0) return 0;
  const { codeWidth } = diffLayout(lines, width);
  const preview = diffPreview(lines, codeWidth, expand);
  return preview.rows + (preview.hidden > 0 ? 1 : 0);
}

/**
 * How much of a stored diff a settled row shows.
 *
 * A single edit can be several hundred lines. Rendering all of them puts a
 * wall of code between the reader and the rest of the conversation, and — far
 * worse — makes the cost of every repaint proportional to the largest diff in
 * the session. Nothing is discarded: the row says how many lines it is holding
 * back, and expanding it (click, or Ctrl+R for the transcript) renders the
 * whole thing.
 */
export const DIFF_PREVIEW_ROWS = 40;

function diffPreview(
  lines: readonly DiffLine[],
  codeWidth: number,
  expand: boolean,
): { readonly shown: readonly DiffLine[]; readonly rows: number; readonly hidden: number } {
  let rows = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const height = Math.max(1, wrapTerminalText(lines[index]!.text, codeWidth).length);
    if (!expand && rows + height > DIFF_PREVIEW_ROWS && index > 0) {
      return { shown: lines.slice(0, index), rows, hidden: lines.length - index };
    }
    rows += height;
  }
  return { shown: lines, rows, hidden: 0 };
}

/**
 * A code change, the way a reviewer reads one.
 *
 * The reason this exists rather than a line count: an agent that edits a file
 * hands back a sentence, and a sentence about a change is not reviewable. The
 * developer either trusts it or opens the file — and doing that for every edit
 * is exactly the friction that makes people stop reading and start hoping.
 *
 * Line numbers come from the diff itself, so they are the real numbers in the
 * real file and can be jumped to. The `-`/`+` column is kept even though the
 * background already encodes it, because a terminal with a broken or
 * monochrome palette must not lose the only signal that says which side a line
 * is on.
 */
export function Diff({ diff, width, path, expand = false }: DiffProps): React.ReactElement | null {
  const lines = parseDiff(diff);
  if (lines.length === 0) return null;

  const language = languageOf(path ?? '');

  // Wide enough for the largest line number in the diff, so the code column
  // does not shift halfway down a hunk.
  const { gutter, codeWidth } = diffLayout(lines, width);
  const { shown, hidden } = diffPreview(lines, codeWidth, expand);

  return (
    <Box flexDirection="column">
      {shown.map((line, index) => (
        <DiffRow
          key={index}
          line={line}
          gutter={gutter}
          width={codeWidth}
          language={language}
        />
      ))}
      {hidden > 0 && (
        <Text color={color('ghost')}>
          {`  … ${hidden} more ${hidden === 1 ? 'line' : 'lines'} ${glyph.divider} click or Ctrl+R to review`}
        </Text>
      )}
    </Box>
  );
}

/** The `Added 9 lines, removed 1 line` line under an edit's header. */
export function DiffSummary({ diff }: { diff: string }): React.ReactElement | null {
  const described = describeStats(diffStats(parseDiff(diff)));
  if (!described) return null;
  return <Text color={color('muted')}>{described}</Text>;
}

/** How many hunks the diff touches, for a one-line summary. */
export function diffHunkCount(diff: string): number {
  return hunksOf(parseDiff(diff)).length;
}

function DiffRow({
  line,
  gutter,
  width,
  language,
}: {
  line: DiffLine;
  gutter: number;
  width: number;
  language: string;
}): React.ReactElement {
  const wrapped = wrapTerminalText(line.text, width);
  const background =
    line.op === 'add' ? diffStyle.addBackground : line.op === 'remove' ? diffStyle.removeBackground : undefined;
  const number = line.op === 'remove' ? line.before : line.after;
  const marker = line.op === 'add' ? '+' : line.op === 'remove' ? '-' : ' ';
  return (
    <Box flexDirection="column">
      {wrapped.map((text, partIndex) => (
        <Box key={partIndex}>
          <Text color={color('ghost')}>{'  '}</Text>
          <Text color={color(line.op === 'context' ? 'ghost' : 'faint')}>
            {partIndex === 0 ? String(number ?? '').padStart(gutter) : ' '.repeat(gutter)}{' '}
          </Text>
          <Text
            color={color(line.op === 'add' && partIndex === 0 ? diffStyle.addMarker : line.op === 'remove' && partIndex === 0 ? diffStyle.removeMarker : 'ghost')}
            {...(background ? { backgroundColor: background } : {})}
          >
            {partIndex === 0 ? marker : ' '}{' '}
          </Text>
          <Text {...(background ? { backgroundColor: background } : {})}>
            {highlight(text, language).map((token, index) => (
              <Text key={index} color={syntaxColor(token.kind)} {...(background ? { backgroundColor: background } : {})}>
                {token.text}
              </Text>
            ))}
            {background && displayWidth(text) < width ? ' '.repeat(width - displayWidth(text)) : ''}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
