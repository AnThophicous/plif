import React from 'react';
import { Box, ScrollView, Text, useSlateEvent } from '../ui.js';

import { diffHeight } from './Diff.js';
import { Markdown } from './Markdown.js';
import { ToolCall, searchResultsHeight } from './ToolCall.js';
import { BLOOM_MARK, spinnerFrameAt, useSpinnerFrame } from './Spinner.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from '../hooks/useAnimationClock.js';
import type { EntryStatus, TimelineEntry } from '../session.js';
import {
  allTranscriptCells,
  initialTranscriptState,
  transcriptReducer,
} from '../transcript/reducer.js';
import type { FileActivity, TranscriptCell } from '../transcript/types.js';
import { color, formatDuration, formatWorkedDuration, glyph, layout, truncate } from '../theme.js';
import { clusterLength, displayWidth, wrapTerminalText } from '../text.js';
import { toneBetween } from '../pulse.js';

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
  // `limit` is a caller asking for a specific window (a preview, a dialog).
  // Everything else keeps every row it was given: the transcript is the record
  // of the session, and quietly dropping the oldest entries once the count
  // passed a threshold is how earlier messages appeared to be deleted. Slate
  // scrolls what does not fit; nothing here decides it never happened.
  const byCount = limit ? entries.slice(-limit) : entries;
  // Only the rows that can actually be on screen are handed to Slate.
  //
  // Slate lays out and reconciles every node it is given, whether or not the
  // scroll viewport can show it, so passing the whole transcript made the cost
  // of *every* frame proportional to the size of the session: a 1.9 MB session
  // measured 4.5 s for the first frame and ~2 s of CPU per keystroke. Nothing
  // is dropped — the rows outside the window are represented by two spacers of
  // exactly their height, so the scrollbar, the scroll offset and the pinned
  // tail all behave as if the full transcript were mounted.
  const slice = useTimelineWindow(byCount, inner, maxLines);
  const visible = slice.rows;
  // Some Windows Terminal/ConPTY builds do not dispatch the scroll callback
  // from a controlled ScrollView. Keep a small application-level fallback so
  // the same wheel event still releases follow mode and produces the notice.
  const logicalScroll = React.useRef(0);
  useSlateEvent(React.useCallback((event) => {
    if (event.kind !== 'mouse' || event.action !== 'scroll' || !event.deltaY) return;
    logicalScroll.current = Math.max(0, logicalScroll.current + event.deltaY);
    slice.onScroll(logicalScroll.current);
  }, [slice.onScroll]));
  // The tail is pinned while the reader is at it, and released while they are
  // not.
  //
  // The danger an unconditional pin was protecting against is the offset and
  // the content disagreeing — a viewport sitting on empty space with the
  // transcript loaded above it and no way back. That is guarded here instead:
  // the high-water mark resets whenever the transcript shrinks or empties, so a
  // cleared or freshly resumed session re-anchors on its own, and the reader
  // keeps the position they chose in every other case.
  // Follow the real transcript, not the windowed subset. The subset remains
  // roughly one viewport long while activity streams, which used to make the
  // controlled scroll value identical on every update. Slate correctly treats
  // an identical prop as no instruction, so the viewport stopped above new
  // work even though `pinned` was true.
  const follow = useTailFollow(byCount.length, slice.onScroll);
  // Shown only when this view has genuinely been scrolled away from its newest
  // row and there is something to be away from. An empty session has nothing
  // below it, and a marker pointing at nothing is a control that lies.
  const showJump = !follow.pinned && visible.length > 0;
  const viewport = maxLines === undefined ? {} : timelineViewport(
    maxLines,
    follow.pinned,
    showJump,
    follow.onScroll,
    // Use the measured end, not an unsafe sentinel. ConPTY/Slate clamps this
    // exact offset consistently and applies it again as the content grows.
    Math.max(0, slice.contentHeight - Math.max(1, maxLines - (showJump ? 1 : 0))),
  );

  return (
    <Box flexDirection="column">
      <ScrollView flexDirection="column" paddingX={layout.gutter} {...viewport}>
        {!process.env.NOSP && slice.above > 0 && <Box height={slice.above} flexShrink={0} />}
        {visible.map((item) => (
          <TimelineRow
            key={item.id}
            entry={item}
            width={inner}
            {...(maxLines === undefined ? {} : { maxLines })}
          />
        ))}
        {!process.env.NOSP && slice.below > 0 && <Box height={slice.below} flexShrink={0} />}
      </ScrollView>
      {showJump && (
        <Box width="100%" justifyContent="center">
          <NewBelowPill added={follow.addedWhileAway} />
        </Box>
      )}
    </Box>
  );
});

/**
 * Per-entry rendered height, cached on the entry itself.
 *
 * Timeline entries are immutable: a row that changes is a new object, so a
 * WeakMap keyed by the entry is a cache that can never go stale and never
 * needs eviction. Without it, windowing would re-measure the whole transcript
 * — including every stored diff — on every frame, which is the cost the window
 * exists to avoid.
 */
const heightCache = new WeakMap<TimelineEntry, Map<number, number>>();

function cachedHeight(entry: TimelineEntry, width: number): number {
  let byWidth = heightCache.get(entry);
  if (!byWidth) {
    byWidth = new Map();
    heightCache.set(entry, byWidth);
  }
  const known = byWidth.get(width);
  if (known !== undefined) return known;
  const height = estimateHeight(entry, width);
  byWidth.set(width, height);
  return height;
}

/**
 * Scroll viewport props for the transcript body.
 *
 * Two things the previous version got wrong, both of which the reader felt:
 *
 * The pinned offset was asserted on every frame. Slate clamps to it, so a wheel
 * tick moved the view and the very next render put it back — the transcript
 * could not be scrolled at all, and every tick still paid for a full frame.
 * Pinning is a statement about the tail, so it is only sent while the view is
 * actually at the tail; once the reader moves away the offset is theirs, and
 * `useTailFollow` re-pins as soon as they come back down.
 *
 * The jump pill sits below this viewport inside the same column, so it is a row
 * of the timeline's own budget. Taking it out of the body height is what keeps
 * the block inside `maxLines`: one row over, and the height-clamped panel that
 * holds the transcript pushes the prompt off the bottom of the window.
 */
export function timelineViewport(
  maxLines: number,
  pinned: boolean,
  showJump: boolean,
  onScroll: (x: number, y: number) => void,
  /** Exact content offset to use while following the tail. */
  tailOffset = 0,
): {
  readonly height: number;
  readonly overflow: 'scroll';
  readonly scrollTop?: number;
  readonly onScroll: (x: number, y: number) => void;
} {
  return {
    height: Math.max(1, maxLines - (showJump ? 1 : 0)),
    overflow: 'scroll' as const,
    ...(pinned ? { scrollTop: tailOffset } : {}),
    onScroll,
  };
}

/** Rows above and below the viewport, kept as height so scrolling is unaffected. */
interface TimelineWindow {
  readonly rows: readonly TimelineEntry[];
  readonly above: number;
  readonly below: number;
  readonly contentHeight: number;
  readonly onScroll: (y: number) => void;
}

/**
 * The slice of the transcript that can be on screen, plus the height of what
 * is not.
 *
 * Overscan is a full viewport in each direction, so an ordinary wheel scroll
 * lands on rows that are already mounted and the window is recomputed behind
 * it rather than in front of it.
 */
function useTimelineWindow(
  entries: readonly TimelineEntry[],
  width: number,
  maxLines: number | undefined,
): TimelineWindow {
  const [scrollTop, setScrollTop] = React.useState<number | null>(null);
  const total = React.useRef(0);

  const onScroll = React.useCallback((y: number) => {
    setScrollTop((previous) => (previous === y ? previous : y));
  }, []);

  return React.useMemo((): TimelineWindow => {
    if (maxLines === undefined) {
      return { rows: entries, above: 0, below: 0, contentHeight: 0, onScroll };
    }
    if (maxLines <= 0 || entries.length === 0) {
      return { rows: [], above: 0, below: 0, contentHeight: 0, onScroll };
    }

    const heights = entries.map((entry) => cachedHeight(entry, width));
    const contentHeight = heights.reduce((sum, height) => sum + height, 0);
    total.current = contentHeight;

    const overscan = Math.max(maxLines, 20);
    // A null offset — and any offset at or past the live tail — means the view
    // is pinned to the newest row, which is where Slate's clamped scrollTop
    // puts it.
    const pinned = scrollTop === null || scrollTop >= contentHeight - maxLines - 1;
    const top = pinned
      ? contentHeight - maxLines - overscan
      : scrollTop - overscan;
    const bottom = pinned ? contentHeight : scrollTop + maxLines + overscan;

    let start = 0;
    let above = 0;
    let cursor = 0;
    while (start < entries.length && cursor + heights[start]! <= top) {
      cursor += heights[start]!;
      above = cursor;
      start += 1;
    }
    let end = start;
    while (end < entries.length && cursor < bottom) {
      cursor += heights[end]!;
      end += 1;
    }
    const below = contentHeight - cursor;

    return {
      rows: entries.slice(start, end),
      above: Math.max(0, above),
      below: Math.max(0, below),
      contentHeight,
      onScroll,
    };
  }, [entries, maxLines, onScroll, scrollTop, width]);
}

/**
 * Whether the timeline is sitting at its newest row, and how much arrived
 * while it was not.
 *
 * Slate reports a scroll offset but not the content height, so "at the end" is
 * derived from the furthest offset this view has ever reached. That is enough
 * for the only decision here, and it degrades safely: a terminal that never
 * emits a scroll event simply stays pinned, which is exactly today's
 * behaviour.
 */
export function useTailFollow(
  rowCount: number,
  observe: (y: number) => void,
): {
  readonly pinned: boolean;
  readonly addedWhileAway: number;
  readonly onScroll: (x: number, y: number) => void;
} {
  const [pinned, setPinned] = React.useState(true);
  const furthest = React.useRef(0);
  const rowsWhenLeft = React.useRef(rowCount);

  const onScroll = React.useCallback((_x: number, y: number) => {
    observe(y);
    // Until this view has scrolled past its first row there is no "away" to be
    // in. Without this, a single scroll event at offset zero on an empty
    // transcript unpinned the view and showed a jump control with nothing to
    // jump to.
    if (furthest.current === 0 && y === 0) return;
    furthest.current = Math.max(furthest.current, y);
    // One line of slack: a view a single row from the end is, to a reader,
    // still at the end, and treating it otherwise makes the pill flicker.
    const atEnd = y >= furthest.current - 1;
    setPinned((was) => {
      if (was && !atEnd) rowsWhenLeft.current = rowCount;
      return atEnd;
    });
  }, [observe, rowCount]);

  React.useEffect(() => {
    if (pinned) rowsWhenLeft.current = rowCount;
  }, [pinned, rowCount]);

  // A cleared or emptied transcript has no tail to be behind. Re-anchor rather
  // than leaving the view stuck in a state the reader never chose.
  React.useEffect(() => {
    if (rowCount === 0) {
      furthest.current = 0;
      rowsWhenLeft.current = 0;
      setPinned(true);
    }
  }, [rowCount]);

  // Fewer rows than last frame means this is not the same transcript any more:
  // /clear ran, or a session was resumed from the picker. The high-water mark
  // belongs to the transcript that produced it, so carrying it across made a
  // freshly opened session report itself as scrolled away from a tail it never
  // had — which showed the jump pill, and cost the prompt its row.
  const previousRowCount = React.useRef(rowCount);
  React.useEffect(() => {
    if (rowCount < previousRowCount.current) {
      furthest.current = 0;
      rowsWhenLeft.current = rowCount;
      setPinned(true);
    }
    previousRowCount.current = rowCount;
  }, [rowCount]);


  return {
    pinned,
    addedWhileAway: Math.max(0, rowCount - rowsWhenLeft.current),
    onScroll,
  };
}

/**
 * The marker that says the conversation moved on without the reader.
 *
 * It names no key on purpose. The main transcript is scrolled by the terminal,
 * not by Plif, so there is no keystroke here to advertise; scrolling back to
 * the newest row re-anchors the view on its own. A control that names a key
 * nothing listens for is worse than no control.
 */
export function NewBelowPill({ added }: { readonly added: number }): React.ReactElement {
  const label = added > 0
    ? `${added} new below ↓`
    : 'newer messages below ↓';
  return (
    <Text color={color('accent')} inverse>{` ${label} `}</Text>
  );
}

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

const TranscriptCellRow = React.memo(function TranscriptCellRow({
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
});

TranscriptCellRow.displayName = 'TranscriptCellRow';

const ActivityCellRow = React.memo(function ActivityCellRow({
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
});

ActivityCellRow.displayName = 'ActivityCellRow';

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
      return {
        id: cell.id,
        kind: 'tool',
        title: cell.title,
        diff: cell.diff,
        status: 'done',
        at,
        ...(cell.file ? fileEntryFields(cell.file) : {}),
      };
    case 'error':
      return {
        id: cell.id,
        kind: 'tool',
        title: cell.title,
        detail: cell.detail,
        status: 'failed',
        at,
        ...(cell.file ? fileEntryFields(cell.file) : {}),
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

/**
 * Cell heights, remembered per cell object.
 *
 * The transcript overlay asks how tall every cell is on every render, so this
 * is O(transcript) work at the paint cadence — 27.76ms of a 33ms frame at a
 * thousand cells, and 91.91ms at three thousand, which is roughly eleven
 * frames a second. That is the whole of "the scroll is slow": the cost of
 * drawing a long session grows with the session, and the work is the same
 * answer recomputed for text that has not changed since it settled.
 *
 * A WeakMap keyed by the cell object is the right shape because cells are
 * immutable — a changed cell is a new object, so it simply misses the cache,
 * and a cell that falls out of the transcript is collected with it. The inner
 * key carries width and expansion because both change the answer.
 *
 * The one thing this relies on is that cells are never mutated in place. They
 * are built fresh by the reducer; a future cell that is edited rather than
 * replaced would read a stale height from here.
 */
const cellHeights = new WeakMap<TranscriptCell, Map<string, number>>();

export function measureTranscriptCell(cell: TranscriptCell, width: number, expanded = false): number {
  const key = `${width}:${expanded ? 1 : 0}`;
  const cached = cellHeights.get(cell);
  const hit = cached?.get(key);
  if (hit !== undefined) return hit;
  const height = computeTranscriptCellHeight(cell, width, expanded);
  if (cached) cached.set(key, height);
  else cellHeights.set(cell, new Map([[key, height]]));
  return height;
}

function computeTranscriptCellHeight(cell: TranscriptCell, width: number, expanded: boolean): number {
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
      // Mirrors the ToolCall/Diff pairing for a plain (non-edits) diff entry:
      // a `-4` margin around the diff itself, plus the header and spacing rows.
      return diffHeight(cell.diff, Math.max(12, inner - 4), expanded) + 2;
    case 'error':
      return wrap(cell.detail, Math.max(8, inner - 4)) + 2;
    case 'approval':
    case 'question':
      return wrap(cell.text) + 1;
    case 'notice':
      return wrap(cell.text);
  }
}

export function measureTranscriptCells(
  cells: readonly TranscriptCell[],
  width: number,
  expanded = false,
): number {
  return cells.reduce((total, cell) => total + measureTranscriptCell(cell, width, expanded), 0);
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
    const height = estimateHeight(item, width, Math.max(0, budget - used));
    const keepRunning = first === entries.length && inFlight(item);
    if (used + height > budget && !keepRunning) break;
    used += height;
    first = index;
  }
  return entries.slice(first);
}

/**
 * Return the number of rows occupied by the same visible slice as Timeline.
 *
 * This is intentionally kept beside `fitToHeight`: mouse hit-testing and the
 * renderer must agree about where a question begins after the transcript.
 * It uses the same conservative estimates as the live view, so a long or
 * still-running row cannot make the click target drift into the prompt.
 */
export function timelineVisibleHeight(
  entries: readonly TimelineEntry[],
  width: number,
  maxLines: number,
  limit?: number,
): number {
  const inner = width - layout.gutter * 2;
  const byCount = limit ? entries.slice(-limit) : entries;
  const visible = maxLines <= 0 ? [] : fitToHeight(byCount, inner, maxLines);
  return visible.reduce(
    (total, item) => total + estimateHeight(item, inner, Math.max(0, maxLines - total)),
    0,
  );
}

function fileEntryFields(file: FileActivity): Pick<TimelineEntry, 'fileCode' | 'fileMode' | 'filePath' | 'fileAdded' | 'fileRemoved'> {
  return {
    fileCode: file.code,
    fileMode: file.mode,
    filePath: file.path,
    fileAdded: file.added,
    fileRemoved: file.removed,
  };
}

/** Resolve a live timeline row for mouse hit-testing. */
export function timelineEntryAtRow(
  entries: readonly TimelineEntry[],
  width: number,
  maxLines: number,
  row: number,
  limit?: number,
): { readonly entry: TimelineEntry; readonly offset: number } | null {
  if (!Number.isSafeInteger(row) || row < 0 || maxLines <= 0) return null;
  const inner = width - layout.gutter * 2;
  const byCount = limit ? entries.slice(-limit) : entries;
  const visible = fitToHeight(byCount, inner, maxLines);
  let cursor = 0;
  for (const entry of visible) {
    const height = estimateHeight(entry, inner, Math.max(0, maxLines - cursor));
    if (row >= cursor && row < cursor + height) {
      return { entry, offset: row - cursor };
    }
    cursor += height;
  }
  return null;
}

/** Wrapped height of one source line at a given width. */
function wrappedHeight(line: string, width: number): number {
  return Math.max(1, Math.ceil(displayWidth(line) / Math.max(8, width)));
}

/**
 * Convert the durable transcript projection into the same rows used by the
 * live timeline. This is deliberately kept beside TimelineRow so resumed
 * sessions cannot drift into a second, subtly different history renderer.
 */
export function timelineEntriesFromTranscriptCells(
  cells: readonly TranscriptCell[],
): readonly TimelineEntry[] {
  return cells.map((cell) => {
    if (cell.kind !== 'activity') return entryFromTranscriptCell(cell);

    const reads = cell.items.filter((item) => item.name === 'read_file' || item.name === 'list_dir').length;
    const running = cell.items.some((item) => item.status === 'running');
    const title = reads === cell.items.length
      ? `${running ? 'Reading' : 'Read'} ${reads} ${reads === 1 ? 'location' : 'locations'}`
      : `${running ? 'Running' : 'Ran'} ${cell.items.length} ${cell.items.length === 1 ? 'tool' : 'tools'}`;
    const detail = cell.items.map((item) => {
      const state = item.status === 'running' ? 'running' : 'done';
      const duration = item.durationMs === undefined ? '' : ` · ${formatDuration(item.durationMs)}`;
      const output = item.output?.trim();
      return `${state} ${item.name}${duration}${output ? `\n${output}` : ''}`;
    }).join('\n');
    const files = cell.items.flatMap((item) => item.file ? [item.file] : []);
    const fileCode = files.length === 1
      ? files[0]!.code
      : files.map((file) => `// ${file.path}\n${file.code}`).join('\n\n');
    const fileAdded = files.reduce((total, file) => total + file.added, 0);
    const fileRemoved = files.reduce((total, file) => total + file.removed, 0);

    return {
      id: cell.id,
      kind: 'tool',
      title,
      ...(detail ? { detail } : {}),
      status: running ? 'active' : 'done',
      toolSummary: `${cell.items.length} ${cell.items.length === 1 ? 'operation' : 'operations'}`,
      at: Date.parse(cell.at) || 0,
      ...(files.length > 0 ? {
        fileCode,
        fileMode: files.every((file) => file.mode === 'creating') ? 'creating' as const : 'editing' as const,
        filePath: files.length === 1 ? files[0]!.path : `${files.length} files`,
        fileAdded,
        fileRemoved,
      } : {}),
    };
  });
}

/** Reconstruct normal terminal rows from persisted events without mutating them. */
export function timelineEntriesFromEvents(
  events: readonly import('@plif/core').ConversationEvent[],
): readonly TimelineEntry[] {
  const transcript = transcriptReducer(initialTranscriptState, { type: 'replace', events });
  const cells = allTranscriptCells(transcript);
  const rows: TimelineEntry[] = [];
  const finishedTurns = new Map<string, { readonly durationMs?: number }>();
  for (const event of events) {
    if (event.kind === 'turn.completed') {
      finishedTurns.set(event.turnId, { durationMs: event.durationMs });
    } else if (event.kind === 'turn.interrupted' || event.kind === 'turn.failed') {
      finishedTurns.set(event.turnId, {});
    }
  }

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    rows.push(...timelineEntriesFromTranscriptCells([cell]));
    const next = cells[index + 1];
    const finished = finishedTurns.get(cell.turnId);
    if (finished && (!next || next.turnId !== cell.turnId)) {
      rows.push({
        id: `history:worked:${cell.turnId}`,
        kind: 'separator',
        title: 'Worked',
        tone: 'faint',
        ...(finished.durationMs === undefined ? {} : { durationMs: finished.durationMs }),
        at: Date.parse(cell.at) || 0,
      });
    }
  }
  return rows;
}

/** Count wrapped rows without allocating the complete line array. */
function wrappedTextHeight(text: string, width: number, ceiling = Number.MAX_SAFE_INTEGER): number {
  const columns = Math.max(8, width);
  let total = 0;
  let start = 0;
  while (true) {
    const end = text.indexOf('\n', start);
    const line = text.slice(start, end === -1 ? text.length : end);
    total += wrappedHeight(line, columns);
    if (total >= ceiling || end === -1) return total;
    start = end + 1;
  }
}

/**
 * The last `budget` wrapped lines of a block of text.
 *
 * Preserve complete source lines when they fit. If a single streamed source
 * line is wider than the viewport budget, clip its leading portion so the
 * live viewport stays bounded and the terminal does not reprocess the entire
 * cumulative paragraph on every frame.
 */
export function tail(text: string, width: number, budget: number): string {
  if (budget <= 0 || !text) return '';
  const columns = Math.max(8, width);
  // A provider commonly streams one paragraph without newlines. This avoids
  // allocating an array containing the entire cumulative answer in that case.
  if (text.lastIndexOf('\n') === -1) return tailLine(text, columns * budget);
  const lines = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const height = wrappedHeight(line, columns);
    if (used + height > budget) {
      const remaining = budget - used;
      if (remaining > 0) kept.unshift(tailLine(line, columns * remaining));
      break;
    }
    used += height;
    kept.unshift(line);
  }
  return kept.join('\n');
}

/** Keep a bounded suffix without parsing a complete streaming paragraph. */
function tailLine(line: string, maxColumns: number): string {
  if (line.length <= maxColumns) return line;
  // Slicing from the end is O(maxColumns), unlike scanning the whole
  // cumulative paragraph to prove it is ASCII. Avoid leaving a low surrogate
  // at the beginning when a Unicode glyph straddles the clipping boundary.
  const suffix = line.slice(-maxColumns);
  const first = suffix.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? suffix.slice(1) : suffix;
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
    rows.push(...wrapThoughtLine(flat, columns));
  }

  return rows.slice(-budget);
}

function wrapThoughtLine(value: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of value.split(' ')) {
    if (!word) continue;
    const wordWidth = displayWidth(word);
    if (row && displayWidth(row) + 1 + wordWidth <= width) {
      row += ` ${word}`;
      continue;
    }
    if (row) {
      rows.push(row);
      row = '';
    }
    if (wordWidth > width) {
      const pieces = wrapTerminalText(word, width);
      rows.push(...pieces.slice(0, -1));
      row = pieces.at(-1) ?? '';
    } else {
      row = word;
    }
  }
  if (row) rows.push(row);
  return rows.length > 0 ? rows : [''];
}

/**
 * How many terminal lines a row will occupy, rounded generously upward.
 *
 * An estimate, not a measurement — Ink does not expose the laid-out height
 * before it paints. Erring high is the safe direction: too high wastes a line
 * of screen, too low lets the frame reach the terminal height and triggers the
 * full-repaint branch this whole mechanism exists to avoid.
 */
export function estimateHeight(
  entry: TimelineEntry,
  width: number,
  ceiling = Number.MAX_SAFE_INTEGER,
): number {
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
    let height = 3;
    for (const text of [entry.title, entry.detail]) {
      if (!text) continue;
      height += wrappedTextHeight(text, column, Math.max(1, ceiling - height));
      if (height > ceiling) return height;
    }
    return height;
  }

  const detailLines = entry.detail
    ? entry.detail.replace(/\s+$/, '').split('\n').filter((line) => line.length > 0).length
    : 0;

  // Settled reasoning stays compact rather than disappearing into a bare
  // duration. One tail line keeps the user's thought visible in the chat; the
  // full block remains available through Ctrl+R without making every turn
  // consume the whole live frame.
  if (entry.kind === 'thinking') {
    if (entry.status === 'active') {
      const liveLines = thoughtLines(entry.detail ?? '', width - 4);
      return 3 + (liveLines.length > 0 ? liveLines.length + 1 : 0);
    }
    if (!entry.expand) return entry.detail?.trim() ? 4 : 3;
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
      // Matches the `width - 6` ToolCall gives each edit's <Diff>.
      return 1 + entry.edits.reduce((total, edit) => total + 1 + diffHeight(edit.diff, width - 6, entry.expand ?? false), 0)
        + editNoteHeight + 1;
    }
    // The diff replaces the ordinary edit summary. Automatic language-server
    // feedback is retained beneath it, so that small note is measured too.
    if (entry.diff) {
      // Matches the `width - 4` ToolCall gives a plain diff's <Diff>.
      return 1 + (entry.toolSummary ? 1 : 0) + diffHeight(entry.diff, width - 4, entry.expand ?? false)
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

export const TimelineRow = React.memo(function TimelineRow({
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
});

TimelineRow.displayName = 'TimelineRow';

/** The model's reasoning: one calm header and a complete, readable body. */
function ThinkingIndicator({
  thinking,
  label,
  plif,
  expand,
  durationMs,
  hasContent,
}: {
  readonly thinking: boolean;
  readonly label: string;
  readonly plif: boolean;
  readonly expand?: boolean;
  readonly durationMs?: number;
  /** Whether this thought has a body worth recovering once it settles. */
  readonly hasContent?: boolean;
}): React.ReactElement {
  void plif;
  const clock = useAnimationFrame(thinking, 'slow');
  // The reasoning header used to walk the whole 256-glyph braille block, one
  // pattern per tick. That is not a cycle, it is noise: the mark changed
  // silhouette on every frame and read as a rendering fault rather than as
  // work in progress. The shared eight-frame family moves inside the cell.
  const pulse = spinnerFrameAt(clock * ANIMATION_INTERVAL_MS);
  // A settled thought folds its body away by default. Plif never drops it \u2014
  // Ctrl+R and a click both bring it back \u2014 but nothing used to say so.
  // "Thought for 9s" and nothing else read as the reasoning having vanished,
  // because the only ways back to it were never named anywhere on screen.
  const recoverable = !thinking && hasContent === true;

  return (
    <Box>
      <Text color={color(thinking ? 'accent' : 'ghost')}>{thinking ? pulse : '\u273d'} </Text>
      {thinking ? (
        <Text color={color('muted')} bold>{label}</Text>
      ) : (
        <Text color={color('muted')} bold>
          {durationMs === undefined ? label : `${label} for ${formatDuration(durationMs)}`}
        </Text>
      )}
      {recoverable && (
        <Text color={color('ghost')}>
          {'  '}{glyph.divider}{'  '}{expand ? 'click to collapse' : 'click or Ctrl+R to review'}
        </Text>
      )}
    </Box>
  );
}

/**
 * The colour of one line of reasoning, by its place in the block.
 *
 * A wall of a single grey is hard to enter and gives no sense of direction.
 * The ramp runs dim at the top to brighter at the newest line, so while a
 * thought streams the eye is pulled to where the writing is actually
 * happening, and a settled block still reads top-to-bottom instead of as one
 * undifferentiated slab.
 *
 * `total <= 1` returns the bright end: a single line is the newest line.
 */
export function thoughtLineTone(index: number, total: number): string {
  if (total <= 1) return toneBetween('ghost', 'muted', 1);
  const ratio = Math.min(1, Math.max(0, index / (total - 1)));
  // Eased so the top of a long thought does not vanish into the background:
  // the ramp spends most of its range in the readable half.
  return toneBetween('ghost', 'muted', 0.35 + ratio * 0.65);
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
  // Keep every streamed line in the Slate scroll surface. The previous
  // three-line tail was a data-loss-looking presentation bug.
  const live = thinking ? wrappedThoughtLines(body, width - 4) : [];
  const expandedLines = entry.expand && body.trim()
    ? wrappedThoughtLines(body, width - 4)
    : [];

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <ThinkingIndicator
        thinking={thinking}
        label={label}
        plif={plif}
        {...(entry.expand === undefined ? {} : { expand: entry.expand })}
        durationMs={entry.durationMs}
        hasContent={body.trim().length > 0}
      />

      {live.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {live.map((line, index) => (
            <Text key={index} color={thoughtLineTone(index, live.length)}>{line || ' '}</Text>
          ))}
        </Box>
      )}

      {entry.expand && body.trim() && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2} marginBottom={1}>
          {expandedLines.map((line, index) => (
            <Text key={index} color={thoughtLineTone(index, expandedLines.length)}>{line || ' '}</Text>
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
// Rows may be paginated by the terminal viewport, but transcript history must
// retain every wrapped line of the user's message.
export const MAX_USER_ROW_LINES = Number.MAX_SAFE_INTEGER;

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
          <Text color={color(index === 0 ? 'accentBright' : 'muted')}>{index === 0 ? `${glyph.prompt} ` : '  '}</Text>
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
  const source = body;

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
        {...(entry.fileCode !== undefined ? { code: entry.fileCode } : {})}
        {...(entry.fileMode !== undefined ? { codeMode: entry.fileMode } : {})}
        {...(entry.filePath !== undefined ? { codePath: entry.filePath } : {})}
        {...(entry.fileAdded !== undefined ? { codeAdded: entry.fileAdded } : {})}
        {...(entry.fileRemoved !== undefined ? { codeRemoved: entry.fileRemoved } : {})}
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
  void live;
  void expand;
  const lines = text.replace(/\s+$/, '').split('\n');

  return (
    <Box flexDirection="column" marginBottom={1}>
      {lines.flatMap((line, index) => wrapTerminalText(line, Math.max(1, width - 4)).map((part, partIndex) => (
        <Box key={`${index}:${partIndex}`}>
          <Text color={color('ghost')}>{'  ' + glyph.rail + ' '}</Text>
          <Text color={color('muted')}>{part || ' '}</Text>
        </Box>
      )))}
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
  if (entry.kind === 'input') return { bullet: glyph.prompt, bulletTone: 'accent' };
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
