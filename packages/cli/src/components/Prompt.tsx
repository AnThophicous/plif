import React from 'react';
import { Box, Text } from '../ui.js';

import { mix, toneBetween, useBreath } from '../pulse.js';
import { plifGlyphAt, plifGlyphColor } from '../plif-glyphs.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from '../hooks/useAnimationClock.js';
import { clusterAt, clusterLength, displayWidth, snap } from '../text.js';
import { color, glyph, layout, truncate } from '../theme.js';
import { FocusFrame } from './FocusFrame.js';
import { PlifGlow } from './PlifGlow.js';

export interface PromptProps {
  readonly value: string;
  readonly cursor: number;
  readonly placeholder: string;
  readonly focused: boolean;
  readonly busy: boolean;
  readonly frameActive?: boolean;
  /** Let the idle frame inhale slowly while the prompt holds focus. */
  readonly breathing?: boolean;
  /** Enables the Plif treatment; the selected effort also controls the frame identity. */
  readonly plif?: boolean;
  /** Selected effort controls the frame's visual identity. */
  readonly effort?: string;
  readonly busyLabel: string;
  readonly busySince?: number;
  readonly width: number;
  /** Ghost suffix painted inside the active input; accepted by Tab only. */
  readonly inlineSuggestion?: string;
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
  // FocusFrame is deliberately compact: two border rows plus the content.
  // Keeping this geometry here prevents the dock budget from lying to Ink and
  // leaves the conversation the same single-frame composition as the shell.
  return 2 + body + queue + footer;
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
  breathing = false,
  plif = false,
  effort,
  width,
  inlineSuggestion,
  maxRows,
  status,
  frameFooter,
  queue,
}: PromptProps): React.ReactElement {
  // Horizontal gutter + prompt prefix. Continuation lines keep the same prefix
  // width, so wrapping stays stable without needing a surrounding frame.
  const available = Math.max(8, width - 8);
  const active = frameActive ?? busy;
  // The active prompt keeps its PLIF glow, but samples the slow shared clock.
  // A 33ms subscription here made the entire lower chrome look like it was
  // refreshing while a provider was waiting.
  const promptFrame = useAnimationFrame(plif && active, 'slow');
  const elapsed = promptFrame * ANIMATION_INTERVAL_MS;
  const hint = busy ? 'queue a message…' : placeholder;
  const rows = visiblePromptRows(
    value.length ? layoutPrompt(value, cursor, available) : [],
    maxRows,
  );

  const PromptGlyph = ({ continuation = false }: { continuation?: boolean }): React.ReactElement => {
    if (continuation) return <Text>{'  '}</Text>;
    const glint = plif && active ? plifGlyphAt(elapsed, 'quiet', 840) : ' ';
    return (
      <Text>
        <Text color={plif && active ? plifGlyphColor(elapsed, 'active') : color(busy ? 'accentDim' : 'muted')}>
          {glyph.prompt}
        </Text>
        <Text color={plif && active ? plifGlyphColor(elapsed, 'quiet') : color(busy ? 'accentDim' : 'muted')}>
          {glint}
        </Text>
      </Text>
    );
  };

  const content = (
    <>
      {value.length === 0 ? (
        <Box width="100%">
          <PromptGlyph />
          {plif ? (
            <PlifGlow
              value={truncate(hint, Math.max(1, available - 1))}
              elapsedMs={elapsed}
              active={active}
              fallback="ghost"
            />
          ) : (
            <Text color={color(busy ? 'accentDim' : 'muted')} wrap="truncate">
              {truncate(hint, Math.max(1, available - 1))}
            </Text>
          )}
        </Box>
      ) : (
        rows.map((row, index) => (
          <Box key={`${row.start}:${row.end}`} width="100%">
            <PromptGlyph continuation={index !== 0} />
            <CursorRow
              row={row}
              focused={focused}
              plif={plif}
              elapsed={elapsed}
              ghostText={
                focused && cursor === value.length && index === rows.length - 1 && inlineSuggestion
                  ? truncate(inlineSuggestion, Math.max(0, available - displayWidth(row.text)))
                  : ''
              }
            />
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
      breathing={breathing && focused}
      {...(footer ? { footer } : {})}
    >
      {/* FocusFrame owns the horizontal inset; applying it here as well clips
          the final content column and leaves a visible gap in the frame. */}
      <Box flexDirection="column" width="100%">
        {content}
      </Box>
    </FocusFrame>
  );
}, (previous, next) => (
  previous.value === next.value &&
  previous.cursor === next.cursor &&
  previous.placeholder === next.placeholder &&
  previous.focused === next.focused &&
  previous.busy === next.busy &&
  previous.frameActive === next.frameActive &&
  previous.breathing === next.breathing &&
  previous.plif === next.plif &&
  previous.effort === next.effort &&
  previous.width === next.width &&
  previous.inlineSuggestion === next.inlineSuggestion &&
  previous.maxRows === next.maxRows &&
  previous.status === next.status &&
  previous.frameFooter === next.frameFooter &&
  previous.queue === next.queue
));

Prompt.displayName = 'Prompt';

/** The cursor's luminance cycle: slow enough to read as breathing, not blinking. */
const CURSOR_BREATH_MS = 1_500;

function CursorRow({
  row,
  focused,
  plif,
  elapsed,
  ghostText = '',
}: {
  row: PromptRow;
  focused: boolean;
  plif: boolean;
  elapsed: number;
  ghostText?: string;
}): React.ReactElement {
  // The slow clock, not the fast one: an idle caret must breathe, and a
  // 33 ms repaint forever is the expensive kind of alive.
  const breath = useBreath(focused && row.cursor !== null, CURSOR_BREATH_MS);
  if (!focused || row.cursor === null) {
    return plif
      ? <PlifGlow value={row.text} elapsedMs={elapsed} />
      : <Text color={color('text')}>{row.text}</Text>;
  }
  const index = snap(row.text, row.cursor);
  const at = clusterAt(row.text, index);
  const before = row.text.slice(0, index);
  const after = row.text.slice(index + (index < row.text.length ? at.length : 0));
  // A filled block whose luminance inhales, rather than hard inverse video.
  // Inverse reads as a selection; a breathing block reads as a caret that
  // knows the interface is alive. PLIF leans the block toward champagne.
  const block = plif
    ? mix(color('accent'), color('accentStrong'), 0.35 + 0.4 * breath)
    : toneBetween('accentDim', 'accent', 0.3 + 0.5 * breath);
  return (
    <Text>
      {plif ? <PlifGlow value={before} elapsedMs={elapsed} /> : <Text color={color('text')}>{before}</Text>}
      <Text backgroundColor={block} color={color('panel')}>{at}</Text>
      {plif ? <PlifGlow value={after} elapsedMs={elapsed} /> : <Text color={color('text')}>{after}</Text>}
      {ghostText && <Text color={color('ghost')}>{ghostText}</Text>}
    </Text>
  );
}
