import React from 'react';
import { Box, Text } from 'ink';

import { useHighlightClock } from '../pulse.js';
import { clusterAt, clusterLength, displayWidth, snap } from '../text.js';
import { color, glyph, layout, truncate } from '../theme.js';
import { FocusFrame } from './FocusFrame.js';
import { PlifGlow, plifGlowCells } from './PlifGlow.js';

export interface PromptProps {
  readonly value: string;
  readonly cursor: number;
  readonly placeholder: string;
  readonly focused: boolean;
  readonly busy: boolean;
  readonly frameActive?: boolean;
  /** Enables the Plif treatment; the selected effort also controls the frame identity. */
  readonly plif?: boolean;
  /** Selected effort controls the frame's visual identity. */
  readonly effort?: string;
  readonly themeRevision?: number;
  readonly busyLabel: string;
  readonly busySince?: number;
  readonly width: number;
  /** Maximum number of input rows to paint; the complete value remains editable. */
  readonly maxRows?: number;
  /** Live operational state shown in the lower compartment of the frame. */
  readonly status?: React.ReactNode;
  /** Optional Plif status dock shown in the lower compartment of the frame. */
  readonly frameFooter?: React.ReactNode;
  readonly queue?: React.ReactNode;
}

export interface PromptRow {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** UTF-16 offset inside text, or null when the cursor is on another row. */
  readonly cursor: number | null;
}

/** Count the rows the prompt body needs at a terminal width. */
export function promptBodyRows(value: string, cursor: number, width: number): number {
  if (!value.length) return 1;
  return layoutPrompt(value, cursor, Math.max(8, width - 8)).length;
}

/**
 * Count the prompt frame, including its optional lower compartment and queue.
 * `bodyRows` is the number of rows that are actually painted, not the length of
 * the underlying draft.
 */
export function promptHeight({
  bodyRows,
  footerRows = 0,
  queueRows = 0,
}: {
  readonly bodyRows: number;
  readonly footerRows?: number;
  readonly queueRows?: number;
}): number {
  const body = Math.max(1, Math.floor(bodyRows));
  const footer = Math.max(0, Math.floor(footerRows));
  const queue = Math.max(0, Math.floor(queueRows));
  return 2 + body + queue + (footer > 0 ? 1 + footer : 0);
}

/**
 * Keep the cursor row visible when a long draft exceeds the frame budget.
 * Source offsets and the full value stay untouched, so editing and cursor
 * movement continue to operate on the complete draft.
 */
export function visiblePromptRows(
  rows: readonly PromptRow[],
  maxRows: number | undefined,
): readonly PromptRow[] {
  if (rows.length === 0 || maxRows === undefined || rows.length <= maxRows) return rows;
  const limit = Math.max(1, Math.floor(maxRows));
  if (limit >= rows.length) return rows;

  const cursorRow = rows.findIndex((row) => row.cursor !== null);
  const anchor = cursorRow >= 0 ? cursorRow : rows.length - 1;
  const before = Math.floor((limit - 1) / 2);
  const start = Math.max(0, Math.min(anchor - before, rows.length - limit));
  return rows.slice(start, start + limit);
}

/**
 * Split prompt text into terminal rows without wasting cells before a wrap.
 * Explicit newlines always win; otherwise a cluster starts a new row only when
 * it would overflow the usable width. Source offsets keep cursor editing in
 * UTF-16 while display widths remain terminal-aware.
 */
export function layoutPrompt(value: string, cursor: number, width: number): readonly PromptRow[] {
  const rows: Omit<PromptRow, 'cursor'>[] = [];
  const available = Math.max(1, width);
  let start = 0;
  let at = 0;
  let cells = 0;

  const push = (end: number): void => {
    rows.push({ start, end, text: value.slice(start, end) });
  };

  while (at < value.length) {
    if (value[at] === '\n') {
      push(at);
      at += 1;
      start = at;
      cells = 0;
      continue;
    }
    const length = clusterLength(value, at) || 1;
    const cluster = value.slice(at, at + length);
    const clusterCells = displayWidth(cluster);
    if (cells > 0 && cells + clusterCells > available) {
      push(at);
      start = at;
      cells = 0;
      continue;
    }
    cells += clusterCells;
    at += length;
  }
  push(value.length);

  const snapped = snap(value, Math.max(0, Math.min(cursor, value.length)));
  return rows.map((row, index) => {
    const atStartOfSoftRow = snapped === row.start && index > 0 && rows[index - 1]?.end === row.start;
    const belongs = atStartOfSoftRow || (snapped >= row.start && snapped <= row.end && !(snapped === row.end && index < rows.length - 1 && rows[index + 1]?.start === row.end));
    return { ...row, cursor: belongs ? snapped - row.start : null };
  });
}

export const Prompt = React.memo(function Prompt({
  value,
  cursor,
  placeholder,
  focused,
  busy,
  frameActive,
  plif = false,
  effort,
  width,
  maxRows,
  status,
  frameFooter,
  queue,
}: PromptProps): React.ReactElement {
  // Horizontal gutter + prompt prefix. Continuation lines keep the same prefix
  // width, so wrapping stays stable without needing a surrounding frame.
  const available = Math.max(8, width - 8);
  const active = frameActive ?? busy;
  const elapsed = useHighlightClock(plif && active);
  const hint = busy ? 'type to queue a message for the agent' : placeholder;
  const rows = visiblePromptRows(
    value.length ? layoutPrompt(value, cursor, available) : [],
    maxRows,
  );

  const PromptGlyph = ({ continuation = false }: { continuation?: boolean }): React.ReactElement => (
    <Text color={plif && active ? plifGlowCells(glyph.prompt, elapsed, true)[0]?.color : color(busy ? 'ghost' : 'muted')}>
      {continuation ? ' ' : glyph.prompt}{' '}
    </Text>
  );

  const content = (
    <>
      {value.length === 0 ? (
        <Box width="100%">
          <PromptGlyph />
          {plif ? (
            <PlifGlow
              value={truncate(hint, available)}
              elapsedMs={elapsed}
              active={active}
              fallback="ghost"
            />
          ) : (
            <Text color={color('ghost')} wrap="truncate">{truncate(hint, available)}</Text>
          )}
        </Box>
      ) : (
        rows.map((row, index) => (
          <Box key={`${row.start}:${row.end}`} width="100%">
            <PromptGlyph continuation={index !== 0} />
            <CursorRow row={row} focused={focused} plif={plif} elapsed={elapsed} />
          </Box>
        ))
      )}
      {queue}
    </>
  );

  const footer = status || frameFooter ? (
    <Box flexDirection="column">
      {status && <Box>{status}</Box>}
      {frameFooter}
    </Box>
  ) : undefined;

  return (
    <FocusFrame
      width={width}
      active={active}
      plif={plif}
      effort={effort}
      {...(footer ? { footer } : {})}
    >
      <Box flexDirection="column" width="100%" paddingX={layout.gutter}>
        {content}
      </Box>
    </FocusFrame>
  );
});

function CursorRow({
  row,
  focused,
  plif,
  elapsed,
}: {
  row: PromptRow;
  focused: boolean;
  plif: boolean;
  elapsed: number;
}): React.ReactElement {
  if (!focused || row.cursor === null) {
    return plif
      ? <PlifGlow value={row.text} elapsedMs={elapsed} />
      : <Text color={color('text')}>{row.text}</Text>;
  }
  const index = snap(row.text, row.cursor);
  const at = clusterAt(row.text, index);
  const before = row.text.slice(0, index);
  const after = row.text.slice(index + (index < row.text.length ? at.length : 0));
  return (
    <Text>
      {plif ? <PlifGlow value={before} elapsedMs={elapsed} /> : <Text color={color('text')}>{before}</Text>}
      <Text inverse>{at}</Text>
      {plif ? <PlifGlow value={after} elapsedMs={elapsed} /> : <Text color={color('text')}>{after}</Text>}
    </Text>
  );
}
