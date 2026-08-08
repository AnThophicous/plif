import React from 'react';
import { Box, Text } from 'ink';

import { diffHeight } from './Diff.js';
import { Markdown } from './Markdown.js';
import { ToolCall } from './ToolCall.js';
import { useSpinnerFrame } from './Spinner.js';
import type { EntryStatus, TimelineEntry } from '../session.js';
import { color, formatDuration, glyph, layout, supportsRichGlyphs, truncate } from '../theme.js';

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
export function Timeline({ entries, width, limit, maxLines }: TimelineProps): React.ReactElement {
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
    if (used + height > budget && !(first === entries.length && inFlight(item))) break;
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

/**
 * How many terminal lines a row will occupy, rounded generously upward.
 *
 * An estimate, not a measurement — Ink does not expose the laid-out height
 * before it paints. Erring high is the safe direction: too high wastes a line
 * of screen, too low lets the frame reach the terminal height and triggers the
 * full-repaint branch this whole mechanism exists to avoid.
 */
export function estimateHeight(entry: TimelineEntry, width: number): number {
  const wrap = (text: string): number =>
    text.split('\n').reduce((total, line) => total + wrappedHeight(line, width), 0);

  if (entry.kind === 'input') return 5;

  if (entry.kind === 'answer') {
    // Markdown adds lines the raw text does not have: blank lines between
    // blocks, gutters on code fences, a bullet's hanging indent. Two extra is
    // the cheap approximation of all of it.
    return wrap([entry.title, entry.detail].filter(Boolean).join('\n')) + 3;
  }

  const detailLines = entry.detail
    ? entry.detail.replace(/\s+$/, '').split('\n').filter((line) => line.length > 0).length
    : 0;

  // Collapsed by default and worth exactly one line when it is. Reasoning is
  // usually the longest thing in the turn and almost never the thing being
  // read, so it may not claim height until asked for.
  if (entry.kind === 'thinking') {
    if (!entry.expand) return 1;
    return 1 + wrap(entry.detail ?? '') + 1;
  }

  if (entry.kind === 'tool') {
    // A diff replaces the output block, so it is measured instead of it — not
    // as well as. Counting both would reserve twice the height an edit row
    // actually takes and cost that much scrollback on every edit.
    if (entry.diff) {
      return 1 + (entry.toolSummary ? 1 : 0) + diffHeight(entry.diff, entry.expand ?? false) + 1;
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
  if (entry.kind === 'tool') return <ToolRow entry={entry} width={width} />;
  return <PlainRow entry={entry} width={width} />;
}

/**
 * A block of model reasoning.
 *
 * One line, collapsed, and that is the whole design. Thinking is genuinely
 * useful — it is where a wrong turn becomes visible before the answer hides
 * it — but it is also several times longer than the answer, and a timeline that
 * shows it inline is a timeline nobody can read. So it announces itself while
 * it happens, states what it cost when it is over, and holds the text until
 * someone asks for it.
 *
 * The finished line is blue rather than the usual grey: a thought that has
 * completed is a real event in the turn, not chrome, and blue is the one colour
 * in the palette that carries information without also meaning "look, a
 * problem".
 */
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
  // The pulse, not the braille spinner. Thinking is a different kind of waiting
  // from a command running, and the two read as different things at a glance.
  const pulse = usePulse(thinking);
  const body = entry.detail ?? '';
  const clipped =
    entry.expand && maxLines !== undefined ? tail(body, width - 4, Math.max(3, maxLines - 2)) : body;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color(thinking ? 'accent' : 'ghost')}>{thinking ? pulse : glyph.step} </Text>
        {thinking ? (
          <Text color={color('accent')}>Thinking</Text>
        ) : (
          <Text color={color('faint')}>{formatDuration(entry.durationMs ?? 0)}</Text>
        )}
        <Text color={color('ghost')}>
          {thinking
            ? ''
            : entry.expand
              ? `  ${glyph.divider} Ctrl+R to collapse`
              : `  ${glyph.divider} Ctrl+R to expand`}
        </Text>
      </Box>

      {entry.expand && body.trim() && (
        <Box flexDirection="column" marginBottom={1}>
          {clipped.split('\n').map((line, index) => (
            <Box key={index}>
              <Text color={color('ghost')}>{'  ' + glyph.rail + ' '}</Text>
              <Text color={color('faint')} italic>
                {truncate(line, Math.max(8, width - 4))}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * The four-frame bullet pulse used for thinking.
 *
 * Slower than the spinner on purpose — a fast animation next to the word
 * "Thinking" reads as urgency, and this is the calmest thing the agent does.
 */
const PULSE_FRAMES = supportsRichGlyphs ? ['✦', '✧', '✶', '✧'] : ['*', '+', 'x', '+'];

function usePulse(active: boolean): string {
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % PULSE_FRAMES.length), 320);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [active]);
  return PULSE_FRAMES[index % PULSE_FRAMES.length] as string;
}

/**
 * What the developer said, in a box.
 *
 * The box is the thing that separates a conversation from a log. Without it the
 * developer's own words look like just another line the agent produced, and
 * scanning back for "what did I actually ask?" means reading everything.
 */
function UserRow({ entry, width }: { entry: TimelineEntry; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box borderStyle="round" borderColor={color('ghost')} paddingX={1} width="100%">
        <Text color={color('muted')}>{glyph.prompt} </Text>
        <Text color={color('text')}>{truncate(entry.title, width - 6)}</Text>
      </Box>
    </Box>
  );
}

/**
 * The agent's answer, loose on the page.
 *
 * Deliberately unboxed and unbulleted: it is the substance, and framing it the
 * same way as a tool row would flatten the distinction between what the agent
 * *did* and what it *concluded*.
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
    <Box flexDirection="column" marginBottom={1}>
      <Markdown source={source} width={width - 2} />
    </Box>
  );
}

function ToolRow({ entry, width }: { entry: TimelineEntry; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <ToolCall
        name={entry.title}
        ok={entry.status !== 'failed'}
        running={entry.status === 'active'}
        width={width}
        expand={entry.expand ?? false}
        {...(entry.diff !== undefined ? { diff: entry.diff } : {})}
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
  if (entry.kind === 'input') return { bullet: glyph.prompt, bulletTone: 'accent' };
  if (entry.kind === 'approval' && entry.status !== 'done' && entry.status !== 'failed') {
    return { bullet: glyph.waiting, bulletTone: 'warn' };
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
