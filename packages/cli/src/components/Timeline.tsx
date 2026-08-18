import React from 'react';
import { Box, Text } from 'ink';

import { diffHeight } from './Diff.js';
import { Markdown } from './Markdown.js';
import { ToolCall, searchResultsHeight } from './ToolCall.js';
import { BLOOM_MARK, useSpinnerFrame } from './Spinner.js';
import { activityGlyphAt, activityKindForLabel, activityVisual, GradientText } from '../activity-visuals.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from '../hooks/useAnimationClock.js';
import type { EntryStatus, TimelineEntry } from '../session.js';
import type { TranscriptCell } from '../transcript/types.js';
import { toneBetween } from '../pulse.js';
import { color, formatDuration, formatWorkedDuration, glyph, layout, truncate } from '../theme.js';
import { clusterLength, displayWidth } from '../text.js';

interface TimelineProps {
  readonly entries: readonly TimelineEntry[];
  readonly width: number;
  /** Rows to render. Older entries scroll out of the frame. */
  readonly limit?: number;
  /**
   * Ceiling on the rendered height, in terminal lines.
   *
   * Not a nicety. Ink writes `clearTerminal + every static line it has ever
   * emitted + the frame` the moment the dynamic frame is as tall as the
   * terminal, and on Windows that escape leaves scrollback intact — so the
   * entire session appears again, and again on the next keystroke. Keeping the
   * live region shorter than the window is what stops that branch being taken
   * at all.
   */
  readonly maxLines?: number;
}

/**
 * The activity log.
 *
 * One entry is one line, plus an optional indented block beneath it. That
 * constraint is doing real work: an agent produces a *lot* of events, and the
 * only way a developer can follow along at speed is if scanning down the
 * left-hand glyph column tells them the shape of what happened without reading
 * a single word.
 *
 * So the glyph column is the primary channel, the title is the secondary one,
 * and colour is used sparingly enough that a red or green line genuinely stands
 * out instead of blending into a rainbow.
 */
export const Timeline = React.memo(function Timeline({
  entries,
  width,
  limit,
  maxLines,
}: TimelineProps): React.ReactElement {
  const inner = width - layout.gutter * 2;
  const byCount = limit ? entries.slice(-limit) : entries.slice(-layout.maxTimelineRows);
  const visible =
    maxLines === undefined
      ? byCount
      : maxLines <= 0
        ? []
        : fitToHeight(byCount, inner, maxLines);

  return (
    <Box flexDirection="column" paddingX={layout.gutter}>
      {visible.map((item) => (
        <TimelineRow
          key={item.id}
          entry={item}
          width={inner}
          {...(maxLines === undefined ? {} : { maxLines })}
        />
      ))}
    </Box>
  );
});

Timeline.displayName = 'Timeline';

/** Render canonical transcript cells through the same rows used by normal mode. */
export function TranscriptCells({
  cells,
  width,
  expanded = false,
}: {
  readonly cells: readonly TranscriptCell[];
  readonly width: number;
  readonly expanded?: boolean;
}): React.ReactElement {
  const inner = Math.max(8, width - layout.gutter * 2);
  return (
    <Box flexDirection="column" paddingX={layout.gutter}>
      {cells.map((cell, index) => (
        <Box
          key={cell.id}
          marginTop={cellSpacing({
            previousTurnId: cells[index - 1]?.turnId ?? null,
            turnId: cell.turnId,
          })}
        >
          <TranscriptCellRow cell={cell} width={inner} expanded={expanded} />
        </Box>
      ))}
    </Box>
  );
}

function TranscriptCellRow({
  cell,
  width,
  expanded,
}: {
  readonly cell: TranscriptCell;
  readonly width: number;
  readonly expanded: boolean;
}): React.ReactElement {
  if (cell.kind === 'activity') {
    return <ActivityCellRow cell={cell} expanded={expanded} />;
  }
  return <TimelineRow entry={entryFromTranscriptCell(cell, expanded)} width={width} />;
}

function ActivityCellRow({
  cell,
  expanded,
}: {
  readonly cell: Extract<TranscriptCell, { readonly kind: 'activity' }>;
  readonly expanded: boolean;
}): React.ReactElement {
  const running = cell.items.some((item) => item.status === 'running');
  const spinner = useSpinnerFrame(80, running);
  const reads = cell.items.filter((item) => item.name === 'read_file' || item.name === 'list_dir').length;
  const summary = reads === cell.items.length
    ? `${running ? 'Reading' : 'Read'} ${reads} ${reads === 1 ? 'location' : 'locations'}`
    : `${running ? 'Running' : 'Ran'} ${cell.items.length} ${cell.items.length === 1 ? 'tool' : 'tools'}`;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color(running ? 'accent' : 'faint')}>
        {running ? spinner : glyph.done} {summary}
      </Text>
      {expanded && cell.items.map((item) => (
        <Box key={item.callId} paddingLeft={2}>
          <Text color={color(item.status === 'running' ? 'muted' : 'ghost')}>
            {item.status === 'running' ? glyph.pending : glyph.step} {item.name}
            {item.durationMs === undefined ? '' : `  ${formatDuration(item.durationMs)}`}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function cellSpacing({
  previousTurnId,
  turnId,
}: {
  readonly previousTurnId: string | null;
  readonly turnId: string;
}): number {
  return previousTurnId !== null && previousTurnId !== turnId ? 1 : 0;
}

function entryFromTranscriptCell(
  cell: Exclude<TranscriptCell, { readonly kind: 'activity' }>,
  expanded = false,
): TimelineEntry {
  const parsedAt = Date.parse(cell.at);
  const at = Number.isFinite(parsedAt) ? parsedAt : 0;
  switch (cell.kind) {
    case 'user':
      return { id: cell.id, kind: 'input', title: cell.text, at };
    case 'assistant':
      return {
        id: cell.id,
        kind: 'answer',
        title: cell.text,
        status: cell.finalized ? 'done' : 'active',
        at,
      };
    case 'reasoning':
      return {
        id: cell.id,
        kind: 'thinking',
        title: cell.finalized ? 'Reasoning' : 'Thinking',
        detail: cell.text,
        expand: expanded,
        status: cell.finalized ? undefined : 'active',
        at,
      };
    case 'diff':
      return { id: cell.id, kind: 'tool', title: cell.title, diff: cell.diff, status: 'done', at };
    case 'error':
      return {
        id: cell.id,
        kind: 'tool',
        title: cell.title,
        detail: cell.detail,
        status: 'failed',
        at,
      };
    case 'approval':
      return {
        id: cell.id,
        kind: 'approval',
        title: cell.text,
        ...(cell.resolution ? { subtitle: cell.resolution } : {}),
        status: cell.resolution ? 'done' : 'blocked',
        at,
      };
    case 'question':
      return {
        id: cell.id,
        kind: 'question',
        title: cell.text,
        ...(cell.answer ? { subtitle: cell.answer } : {}),
        status: cell.answer ? 'done' : 'blocked',
        at,
      };
    case 'notice':
      return { id: cell.id, kind: 'notice', title: cell.text, tone: cell.tone, at };
  }
}

export function measureTranscriptCell(cell: TranscriptCell, width: number): number {
  const inner = Math.max(8, width - layout.gutter * 2);
  const wrap = (text: string, columns = inner): number =>
    text.split('\n').reduce((total, line) => total + wrappedHeight(line, columns), 0);
  switch (cell.kind) {
    case 'user':
      return wrap(cell.text, Math.max(8, inner - 4)) + 4;
    case 'assistant':
      return wrap(cell.text, Math.max(8, inner - 3)) + 2;
    case 'reasoning':
      return wrap(cell.text, Math.max(8, inner - 3)) + 2;
    case 'activity':
      return 2 + cell.items.length;
    case 'diff':
      return diffHeight(cell.diff, false) + 2;
    case 'error':
      return wrap(cell.detail, Math.max(8, inner - 4)) + 2;
    case 'approval':
    case 'question':
      return wrap(cell.text) + 1;
    case 'notice':
      return wrap(cell.text);
  }
}

export function measureTranscriptCells(cells: readonly TranscriptCell[], width: number): number {
  return cells.reduce((total, cell) => total + measureTranscriptCell(cell, width), 0);
}

/**
 * Keep the newest entries that fit, dropping from the top.
 *
 * A row still in flight is kept even when it does not fit, because dropping it
 * would leave a running command with nowhere to show its output — and a live
 * row is bounded anyway, `Detail` elides it to about a dozen lines.
 *
 * A settled row that does not fit is dropped instead. It is on its way to
 * scrollback within the tick, and rendering it here first is what makes the
 * frame overflow — which is the one thing this must not do. `/help` and
 * `/policy` are the rows that reach this branch.
 */
function fitToHeight(
  entries: readonly TimelineEntry[],
  width: number,
  budget: number,
): readonly TimelineEntry[] {
  const inFlight = (item: TimelineEntry): boolean =>
    item.status === 'active' || item.status === 'pending' || item.status === 'blocked';

  let used = 0;
  let first = entries.length;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index]!;
    const height = estimateHeight(item, width);
    const keepRunning = first === entries.length && inFlight(item);
    if (used + height > budget && !keepRunning) break;
    used += height;
    first = index;
  }
  return entries.slice(first);
}

/** Wrapped height of one source line at a given width. */
function wrappedHeight(line: string, width: number): number {
  return Math.max(1, Math.ceil(line.length / Math.max(8, width)));
}

/**
 * The last `budget` wrapped lines of a block of text.
 *
 * Whole source lines only. Cutting mid-paragraph would leave a sentence
 * beginning nowhere, and the paragraph that gets dropped is one the developer
 * can still scroll to the moment the answer settles.
 */
export function tail(text: string, width: number, budget: number): string {
  const lines = text.split('\n');
  let used = 0;
  let first = lines.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const height = wrappedHeight(lines[index]!, width);
    if (used + height > budget && first < lines.length) break;
    used += height;
    first = index;
  }
  return lines.slice(first).join('\n');
}

export const LIVE_THOUGHT_LINES = 3;
export const ANSWER_GUTTER = 3;

export function thoughtLines(
  text: string,
  width: number,
  budget = LIVE_THOUGHT_LINES,
): readonly string[] {
  const columns = Math.max(8, width);
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return [];

  const rows: string[] = [];
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

  return rows.slice(-budget);
}

/** Wrap a settled thought without flattening its deliberate paragraph breaks. */
export function wrappedThoughtLines(
  text: string,
  width: number,
  budget = Number.MAX_SAFE_INTEGER,
): readonly string[] {
  const columns = Math.max(8, width);
  const rows: string[] = [];

  for (const source of text.split(/\r?\n/)) {
    const flat = source.replace(/\s+/g, ' ').trim();
    if (!flat) {
      rows.push('');
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

  return rows.slice(-budget);
}

/**
 * How many terminal lines a row will occupy, rounded generously upward.
 *
 * An estimate, not a measurement — Ink does not expose the laid-out height
 * before it paints. Erring high is the safe direction: too high wastes a line
 * of screen, too low lets the frame reach the terminal height and triggers the
 * full-repaint branch this whole mechanism exists to avoid.
 */
export function estimateHeight(entry: TimelineEntry, width: number): number {
  const wrap = (text: string, column = width): number =>
    text.split('\n').reduce((total, line) => total + wrappedHeight(line, column), 0);

  if (entry.kind === 'input') {
    const { lines, hidden } = userRowLines(entry.title, Math.max(8, width - 14));
    return 4 + lines.length + (hidden > 0 ? 1 : 0);
  }

  if (entry.kind === 'answer') {
    // Markdown adds lines the raw text does not have: blank lines between
    // blocks, gutters on code fences, a bullet's hanging indent. Two extra is
    // the cheap approximation of all of it. The answer gutter narrows the text
    // column, so the same prose wraps onto more rows than the raw width says.
    const column = Math.max(8, width - ANSWER_GUTTER);
    return (
      [entry.title, entry.detail]
        .filter(Boolean)
        .join('\n')
        .split('\n')
        .reduce((total, line) => total + wrappedHeight(line, column), 0) + 3
    );
  }

  const detailLines = entry.detail
    ? entry.detail.replace(/\s+$/, '').split('\n').filter((line) => line.length > 0).length
    : 0;

  // Collapsed by default and worth exactly one line when it is. Reasoning is
  // usually the longest thing in the turn and almost never the thing being
  // read, so it may not claim height until asked for — apart from the few rows
  // of live tail an open thinking row draws while the thought is forming.
  if (entry.kind === 'thinking') {
    if (entry.status === 'active') {
      const liveLines = thoughtLines(entry.detail ?? '', width - 4);
      return 3 + (liveLines.length > 0 ? liveLines.length + 1 : 0);
    }
    if (!entry.expand) return 3;
    return 4 + wrap(entry.detail ?? '', width - 4);
  }

  if (entry.kind === 'separator') return 2;

  if (entry.kind === 'tool') {
    const editNoteLines = entry.expand ? detailLines : Math.min(detailLines, 5);
    const editNoteHeight = editNoteLines + (editNoteLines < detailLines ? 1 : 0);
    if (entry.searchResults?.length) {
      return 1 + (entry.toolSummary ? 1 : 0)
        + searchResultsHeight(entry.searchResults, entry.expand ?? false) + 1;
    }
    if (entry.executions?.length) {
      if (!entry.expand) return 2;
      return 2 + entry.executions.reduce(
        (total, execution) => total + 1 + (execution.output?.split(/\r?\n/).filter(Boolean).length ?? 0),
        0,
      );
    }
    if (entry.planItems?.length) {
      const shown = entry.expand ? entry.planItems.length : Math.min(entry.planItems.length, 4);
      return 1 + shown + (shown < entry.planItems.length ? 1 : 0) + 1;
    }
    if (entry.edits?.length) {
      return 1 + entry.edits.reduce((total, edit) => total + 1 + diffHeight(edit.diff, entry.expand ?? false), 0)
        + editNoteHeight + 1;
    }
    // The diff replaces the ordinary edit summary. Automatic language-server
    // feedback is retained beneath it, so that small note is measured too.
    if (entry.diff) {
      return 1 + (entry.toolSummary ? 1 : 0) + diffHeight(entry.diff, entry.expand ?? false)
        + editNoteHeight + 1;
    }
    const shown = entry.expand
      ? detailLines
      : Math.min(detailLines, entry.status === 'failed' ? 20 : 8);
    return 1 + (entry.toolSummary ? 1 : 0) + shown + (shown < detailLines ? 1 : 0) + 1;
  }

  const shown = entry.expand ? detailLines : Math.min(detailLines, 13);
  return 1 + shown + (shown > 0 ? 1 : 0);
}

export function TimelineRow({
  entry,
  width,
  maxLines,
}: {
  entry: TimelineEntry;
  width: number;
  maxLines?: number;
}): React.ReactElement {
  if (entry.kind === 'input') return <UserRow entry={entry} width={width} />;
  if (entry.kind === 'answer') {
    return <AnswerRow entry={entry} width={width} {...(maxLines === undefined ? {} : { maxLines })} />;
  }
  if (entry.kind === 'thinking') {
    return <ThinkingRow entry={entry} width={width} {...(maxLines === undefined ? {} : { maxLines })} />;
  }
  if (entry.kind === 'separator') return <CycleSeparator entry={entry} width={width} />;
  if (entry.kind === 'tool') return <ToolRow entry={entry} width={width} />;
  return <PlainRow entry={entry} width={width} />;
}

/**
 * A block of model reasoning.
 *
 * While it is being written it shows its own tail — a few rows of the thought
 * as it forms, in the accent family, because reasoning is where a wrong turn
 * becomes visible before the answer hides it. The moment it settles the block
 * folds back to one grey line, since it is also several times longer than the
 * answer and a timeline that keeps it open is a timeline nobody can read. The
 * text is held, not discarded: Ctrl+R brings it back.
 */
function ThinkingIndicator({
  thinking,
  label,
  plif,
  expand,
  durationMs,
}: {
  readonly thinking: boolean;
  readonly label: string;
  readonly plif: boolean;
  readonly expand?: boolean;
  readonly durationMs?: number;
}): React.ReactElement {
  void plif;
  const clock = useAnimationFrame(thinking, 'slow');
  const activityLabel = label.replace(/^plif\s+/i, '') || 'Thinking';
  const kind = activityKindForLabel(activityLabel);
  const visual = activityVisual(kind);
  const pulse = activityGlyphAt(kind, clock * ANIMATION_INTERVAL_MS, thinking);

  return (
    <Box>
      <Text color={color(thinking ? 'accent' : 'ghost')}>{thinking ? pulse : glyph.step} </Text>
      {thinking ? (
        <GradientText value={activityLabel} from={visual.gradient[0]} to={visual.gradient[1]} bold />
      ) : (
        <Text color={color('faint')}>
          {expand ? `${label}:` : `thought ${formatDuration(durationMs ?? 0)}`}
        </Text>
      )}
      <Text color={color('ghost')}>
        {thinking
          ? ''
          : expand
            ? `  ${formatDuration(durationMs ?? 0)}`
            : `  ${glyph.divider} Ctrl+R history`}
      </Text>
    </Box>
  );
}

function ThinkingRow({
  entry,
  width,
  maxLines,
}: {
  entry: TimelineEntry;
  width: number;
  maxLines?: number;
}): React.ReactElement {
  const thinking = entry.status === 'active';
  const label = entry.title || 'Thinking';
  const plif = label === 'Plif Thinking';
  const body = entry.detail ?? '';
  const live = thinking ? thoughtLines(body, width - 4) : [];
  const clipped =
    entry.expand && maxLines !== undefined ? tail(body, width - 4, Math.max(3, maxLines - 2)) : body;
  const expandedLines = entry.expand && body.trim()
    ? wrappedThoughtLines(clipped, width - 4, maxLines === undefined ? undefined : Math.max(1, maxLines - 2))
    : [];

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <ThinkingIndicator
        thinking={thinking}
        label={label}
        plif={plif}
        {...(entry.expand === undefined ? {} : { expand: entry.expand })}
        durationMs={entry.durationMs}
      />

      {live.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {live.map((line, index) => {
            // The reference grammar: every step hangs off the branch rail,
            // the last one closes it, and the status column — a champagne
            // check for what has been thought through, an ellipsis for the
            // thought still forming — sits at the right edge of the block.
            const last = index === live.length - 1;
            const gap = Math.max(1, width - 6 - displayWidth(line));
            return (
              <Box key={index}>
                <Text color={color('ghost')}>{`  ${last ? '  ' : glyph.rail} ${glyph.branch} `}</Text>
                <Text color={toneBetween(plif ? 'accent' : 'brand', plif ? 'gold' : 'accent', (index + 1) / live.length)}>{line}</Text>
                {last
                  ? <Text color={color('muted')}>{' '.repeat(gap)}…</Text>
                  : <Text color={color('goldDim')}>{' '.repeat(gap)}✓</Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {entry.expand && body.trim() && (
        <Box flexDirection="column" marginBottom={1}>
          {expandedLines.map((line, index) => (
            <Box key={index}>
              <Text color={color('ghost')}>{'  ' + glyph.rail + ' '}</Text>
              <Text color={color('faint')} italic>{line}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * The line that closes out a run.
 *
 * It used to be a full-width rule drawn after every model/tool cycle, which
 * meant a twenty-step task ended up with twenty horizontal rules through it —
 * the transcript read as a stack of receipts rather than one piece of work.
 * Now it appears once, when the agent has finished everything it had to do,
 * and it is the same bloom that was turning while the work happened.
 */
function CycleSeparator({ entry, width }: { entry: TimelineEntry; width: number }): React.ReactElement {
  void width;
  return (
    <Box marginTop={1}>
      <Text color={color('accentDim')}>{BLOOM_MARK}</Text>
      <Text color={color('ghost')}> worked {formatWorkedDuration(entry.durationMs ?? 0)}</Text>
    </Box>
  );
}

/** The developer's line is open on the page, matching the reference composition. */
export const MAX_USER_ROW_LINES = 6;

export function userRowLines(
  title: string,
  width: number,
): { readonly lines: readonly string[]; readonly hidden: number } {
  const columns = Math.max(8, width);
  const wrapped: string[] = [];
  for (const source of title.split('\n')) {
    if (!source) {
      wrapped.push('');
      continue;
    }
    let line = '';
    let cells = 0;
    for (let at = 0; at < source.length; ) {
      const length = clusterLength(source, at) || 1;
      const cluster = source.slice(at, at + length);
      const clusterCells = displayWidth(cluster);
      if (line && cells + clusterCells > columns) {
        wrapped.push(line);
        line = '';
        cells = 0;
      }
      line += cluster;
      cells += clusterCells;
      at += length;
    }
    wrapped.push(line);
  }
  const lines = wrapped.slice(0, MAX_USER_ROW_LINES);
  return { lines: lines.length > 0 ? lines : [''], hidden: Math.max(0, wrapped.length - lines.length) };
}

function UserRow({ entry, width }: { entry: TimelineEntry; width: number }): React.ReactElement {
  const titleWidth = Math.max(8, width - 4);
  const { lines, hidden } = userRowLines(entry.title, titleWidth);
  const rows = hidden > 0 ? [...lines, truncate(`… +${hidden} more lines`, titleWidth)] : lines;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {rows.map((line, index) => {
        const elision = hidden > 0 && index === rows.length - 1;
        return <Box key={index} width="100%">
          <Text color={color(index === 0 ? 'gold' : 'muted')}>{index === 0 ? `${glyph.prompt} ` : '  '}</Text>
          <Text color={color(elision ? 'ghost' : 'accentBright')}>{line}</Text>
        </Box>;
      })}
    </Box>
  );
}

/**
 * The agent's answer, loose on the page but claimed by a bullet.
 *
 * Still unboxed — the box is the developer's, and giving the agent one too
 * would make a conversation look like two logs. What it gets instead is a
 * single marker in the gutter and a hanging indent underneath, so a glance
 * down the left edge says who is speaking without reading a word. The body
 * stays plain: this is the substance, and colouring it would put it in
 * competition with the tool rows it is supposed to conclude.
 */
function AnswerRow({
  entry,
  width,
  maxLines,
}: {
  entry: TimelineEntry;
  width: number;
  maxLines?: number;
}): React.ReactElement {
  const body = [entry.title, entry.detail].filter(Boolean).join('\n');

  // While the answer is still being written, show its tail. A long one would
  // otherwise grow past the window and put Ink on the repaint path — and the
  // tail is the right end to keep anyway, since that is where the words are
  // still appearing. Once it settles the row renders whole, and the timeline
  // hands it to scrollback if it no longer fits.
  //
  // Measured in wrapped lines, not source lines: prose arrives as a handful of
  // very long paragraphs, so counting `\n` would find four lines where the
  // terminal draws forty and clip nothing at all.
  const streaming = entry.status === 'active';
  const source =
    streaming && maxLines !== undefined ? tail(body, width - 2, maxLines) : body;

  return (
    <Box marginBottom={1} width="100%">
      {/*
        The gap comes from the box, not from spaces after the glyph. A trailing
        space inside a gutter this narrow is the first thing squeezed out when
        the glyph turns out wider than budgeted, which is exactly how the mark
        ended up touching the text.
      */}
      <Box width={ANSWER_GUTTER} flexShrink={0}>
        <Text color={color(streaming ? 'accent' : 'faint')}>{glyph.speak}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown source={source} width={Math.max(8, width - 2 - ANSWER_GUTTER)} />
      </Box>
    </Box>
  );
}

function ToolRow({ entry, width }: { entry: TimelineEntry; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <ToolCall
        name={entry.title}
        {...(entry.toolCategory !== undefined ? { category: entry.toolCategory } : {})}
        ok={entry.status !== 'failed'}
        running={entry.status === 'active'}
        width={width}
        expand={entry.expand ?? false}
        {...(entry.diff !== undefined ? { diff: entry.diff } : {})}
        {...(entry.edits !== undefined ? { edits: entry.edits } : {})}
        {...(entry.planItems !== undefined ? { planItems: entry.planItems } : {})}
        {...(entry.searchResults !== undefined ? { searchResults: entry.searchResults } : {})}
        {...(entry.executions !== undefined ? { executions: entry.executions } : {})}
        {...(entry.toolTarget !== undefined ? { target: entry.toolTarget } : {})}
        {...(entry.toolSummary !== undefined ? { summary: entry.toolSummary } : {})}
        {...(entry.detail !== undefined ? { output: entry.detail } : {})}
      />
    </Box>
  );
}

function PlainRow({ entry, width }: { entry: TimelineEntry; width: number }): React.ReactElement {
  // Called unconditionally — hooks cannot be conditional, and only the value is
  // used conditionally. The interval is paused when the row is not active, so
  // a finished timeline costs no timers.
  const spinner = useSpinnerFrame(80, entry.status === 'active');

  const { bullet, bulletTone } = marker(entry, spinner);
  const tone = entry.tone ?? defaultTone(entry.kind);

  // The tag occupies a fixed right-hand column so tags line up across rows even
  // when titles differ wildly in length — an aligned column of [done]s reads as
  // a status list; a ragged one reads as noise.
  const tagWidth = entry.tag ? entry.tag.length + 1 : 0;
  const titleWidth = Math.max(8, width - 2 - tagWidth);

  return (
    <Box flexDirection="column">
      <Box width="100%">
        <Box flexGrow={1}>
          <Text color={color(bulletTone)}>{bullet} </Text>
          <Text color={color(tone)} bold={entry.kind === 'input'}>
            {truncate(entry.title, titleWidth)}
          </Text>
          {entry.subtitle && (
            <Text color={color('faint')}>
              {' '}
              {truncate(entry.subtitle, Math.max(0, titleWidth - entry.title.length - 1))}
            </Text>
          )}
        </Box>
        {entry.tag && <Text color={color(tagTone(entry))}>{entry.tag}</Text>}
      </Box>

      {entry.detail && (
        <Detail
          text={entry.detail}
          width={width}
          live={entry.status === 'active'}
          expand={entry.expand ?? false}
        />
      )}
    </Box>
  );
}

/**
 * An indented block under an entry, hung off a vertical rail.
 *
 * The rail is what visually binds ten lines of command output to the one line
 * that caused it. Without it, output floats free and the log stops being
 * readable after the third command.
 */
function Detail({
  text,
  width,
  live = false,
  expand = false,
}: {
  text: string;
  width: number;
  live?: boolean;
  expand?: boolean;
}): React.ReactElement {
  const lines = text.replace(/\s+$/, '').split('\n');

  // While output is still arriving, show the tail — the newest lines are the
  // ones the developer is waiting on. Once the command is done, the middle is
  // elided instead: the first lines say what started, the last say how it
  // ended, and the middle of a 400-line build log carries the least per line.
  const head = live ? 0 : 8;
  const tail = live ? 10 : 4;
  const elided = !expand && lines.length > head + tail + 1;
  const shown = elided
    ? [...lines.slice(0, head), null, ...lines.slice(-tail)]
    : lines;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {shown.map((line, index) => (
        <Box key={index}>
          <Text color={color('ghost')}>{'  ' + glyph.rail + ' '}</Text>
          {line === null ? (
            <Text color={color('ghost')} italic>
              … {lines.length - head - tail} {live ? 'earlier' : 'more'} lines
            </Text>
          ) : (
            <Text color={color('muted')}>{truncate(line, Math.max(8, width - 4))}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

function marker(
  entry: TimelineEntry,
  spinner: string,
): {
  bullet: string;
  bulletTone: Parameters<typeof color>[0];
} {
  if (entry.kind === 'input') return { bullet: glyph.prompt, bulletTone: 'gold' };
  if (entry.kind === 'approval' && entry.status !== 'done' && entry.status !== 'failed') {
    return { bullet: glyph.waiting, bulletTone: 'warn' };
  }
  if (entry.kind === 'question' && entry.status !== 'done' && entry.status !== 'failed') {
    return { bullet: glyph.question, bulletTone: 'accent' };
  }

  const byStatus: Record<EntryStatus, { bullet: string; bulletTone: Parameters<typeof color>[0] }> =
    {
      pending: { bullet: glyph.pending, bulletTone: 'ghost' },
      // A row in flight animates, so a slow command never looks like a hung one.
      active: { bullet: spinner, bulletTone: 'accent' },
      done: { bullet: glyph.done, bulletTone: 'success' },
      failed: { bullet: glyph.failed, bulletTone: 'danger' },
      blocked: { bullet: glyph.waiting, bulletTone: 'warn' },
    };
  if (entry.status) return byStatus[entry.status];

  if (entry.kind === 'notice') return { bullet: glyph.step, bulletTone: entry.tone ?? 'muted' };
  return { bullet: glyph.step, bulletTone: 'accentDim' };
}

function defaultTone(kind: TimelineEntry['kind']): NonNullable<TimelineEntry['tone']> {
  switch (kind) {
    case 'input':
      return 'text';
    case 'output':
      return 'muted';
    case 'notice':
      return 'muted';
    default:
      return 'text';
  }
}

function tagTone(entry: TimelineEntry): Parameters<typeof color>[0] {
  if (entry.status === 'failed') return 'danger';
  if (entry.status === 'done') return 'success';
  if (entry.status === 'blocked') return 'warn';
  return 'ghost';
}
