import React from 'react';
import { Box, Text } from '../ui.js';

import { describeStats, diffStats, hunksOf, parseDiff } from '@plif/core';
import type { DiffLine } from '@plif/core';
import { color, diffStyle, syntaxColor } from '../theme.js';
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

/** Diff lines shown before the fold. */
// Kept for layout compatibility; rendering itself always retains the full
// diff so the historical record is never silently shortened.
const COLLAPSED_LINES = 14;

/**
 * Background tints for the two sides.
 *
 * Dark enough to read light text on, and desaturated enough that a screen with
 * forty changed lines does not become a red and green wall. The foreground
 * still carries the syntax colours — the background says which side, the
 * colours say what the code is, and neither has to shout.
 */
/** Height in terminal lines, for the caller's layout budget. */
export function diffHeight(diff: string, expand: boolean): number {
  const lines = parseDiff(diff);
  const shown = expand ? lines.length : Math.min(lines.length, COLLAPSED_LINES);
  return shown + 2;
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
  const shown = lines;

  // Wide enough for the largest line number in the diff, so the code column
  // does not shift halfway down a hunk.
  const gutter = Math.max(
    3,
    String(Math.max(...lines.map((line) => line.after ?? line.before ?? 0))).length,
  );
  const codeWidth = Math.max(12, width - gutter - 6);

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
