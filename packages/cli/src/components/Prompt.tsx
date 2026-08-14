import React from 'react';
import { Box, Text } from 'ink';

import { clusterAt, clusterLength, displayWidth, snap } from '../text.js';
import { color, glyph, layout, truncate } from '../theme.js';
import { FocusFrame } from './FocusFrame.js';

export interface PromptProps {
  readonly value: string;
  readonly cursor: number;
  readonly placeholder: string;
  readonly focused: boolean;
  readonly busy: boolean;
  readonly frameActive?: boolean;
  readonly busyLabel: string;
  readonly busySince?: number;
  readonly width: number;
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

export function Prompt({
  value,
  cursor,
  placeholder,
  focused,
  busy,
  frameActive,
  width,
  status,
  frameFooter,
  queue,
}: PromptProps): React.ReactElement {
  // Horizontal gutter + prompt prefix. Continuation lines keep the same prefix
  // width, so wrapping stays stable without needing a surrounding frame.
  const available = Math.max(8, width - 8);
  const hint = busy ? 'type to queue a message for the agent' : placeholder;
  const rows = value.length ? layoutPrompt(value, cursor, available) : [];

  const content = (
    <>
      {value.length === 0 ? (
        <Box width="100%">
          <Text color={color(busy ? 'ghost' : 'muted')}>{glyph.prompt} </Text>
          <Text color={color('ghost')} wrap="truncate">{truncate(hint, available)}</Text>
        </Box>
      ) : (
        rows.map((row, index) => (
          <Box key={`${row.start}:${row.end}`} width="100%">
            <Text color={color(busy ? 'ghost' : 'muted')}>{index === 0 ? glyph.prompt : ' '} </Text>
            <CursorRow row={row} focused={focused} />
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
    <FocusFrame width={width} active={frameActive ?? busy} {...(footer ? { footer } : {})}>
      <Box flexDirection="column" width="100%" paddingX={layout.gutter}>
        {content}
      </Box>
    </FocusFrame>
  );
}

function CursorRow({ row, focused }: { row: PromptRow; focused: boolean }): React.ReactElement {
  if (!focused || row.cursor === null) return <Text color={color('text')}>{row.text}</Text>;
  const index = snap(row.text, row.cursor);
  const at = clusterAt(row.text, index);
  const before = row.text.slice(0, index);
  const after = row.text.slice(index + (index < row.text.length ? at.length : 0));
  return (
    <Text>
      <Text color={color('text')}>{before}</Text>
      <Text inverse>{at}</Text>
      <Text color={color('text')}>{after}</Text>
    </Text>
  );
}
