import React from 'react';
import { Box, Text } from 'ink';

import { useSpinnerFrame } from './Spinner.js';
import type { SubagentLine, SubagentView } from '../session.js';
import { color, formatDuration, glyph, layout, truncate } from '../theme.js';
import { Meter } from './Meter.js';

interface SubagentsProps {
  readonly views: readonly SubagentView[];
  readonly focus: number;
  readonly open: boolean;
  readonly width: number;
  /** Redrawn on a timer so elapsed counters move. */
  readonly now: number;
}

/** Activity lines drawn for the focused tab. */
const VISIBLE_LINES = 5;

/** Height in terminal lines, for the caller's layout budget. */
export function subagentsHeight(views: readonly SubagentView[], open: boolean): number {
  if (views.length === 0) return 0;
  if (!open) return 1;
  // Border, tab strip, the model line, a possible live "Thinking" line, the
  // activity lines, a possible summary, and the margin. Counted at the maximum
  // rather than at what is on screen: the panel grows while the frame is being
  // laid out, and a budget that assumed the smaller shape is how the frame
  // reaches terminal height and triggers a full repaint.
  return 2 + 1 + 1 + 1 + VISIBLE_LINES + 1 + 1;
}

/**
 * Delegated agents, each as its own small session.
 *
 * A subagent is a whole plif run — its own model, its own context, its own
 * thinking and tools — and collapsing that to `subagent · 7 tool calls` on the
 * parent's timeline threw away everything interesting about it. A developer who
 * has just fanned out four investigations wants to see four things working, and
 * wants to be able to look inside any one of them.
 *
 * So this is a tab strip, not a list. Every child gets a tab; the focused one
 * shows what it is doing right now, a line at a time. What it deliberately does
 * *not* do is render a banner, a header, a prompt or a footer per child — the
 * chrome that makes sense once, at the top of a session, is noise repeated four
 * times, and the whole panel has to fit above the prompt without pushing the
 * frame to terminal height.
 *
 * The child's steps stay out of the parent's transcript throughout. This is a
 * live view onto another agent, not a merge of two logs.
 */
export function Subagents({
  views,
  focus,
  open,
  width,
  now,
}: SubagentsProps): React.ReactElement | null {
  const spinner = useSpinnerFrame(80, views.some((view) => view.status === 'running'));
  if (views.length === 0) return null;

  const running = views.filter((view) => view.status === 'running').length;

  if (!open) {
    return (
      <Box flexDirection="column" paddingX={layout.gutter}>
        {views.filter((view) => view.status === 'running').map((view) => (
          <Box key={view.taskId}>
            <Text color={color('accent')}>{spinner} </Text>
            <Text color={color('accent')} bold>{view.title.split(/\s+/)[0]}</Text>
            <Text color={color('muted')}> {truncate(view.title.split(/\s+/).slice(1).join(' '), width - 34)}</Text>
            <Text color={color('ghost')}> {formatDuration(now - view.startedAt)}</Text>
          </Box>
        ))}
        <Text color={color('ghost')}>Ctrl+S {glyph.divider} {running}/{views.length} agents active</Text>
      </Box>
    );
  }

  const index = Math.min(Math.max(0, focus), views.length - 1);
  const active = views[index] as SubagentView;
  const inner = width - 4;

  return (
    <Box paddingX={layout.gutter}>
      <Box flexDirection="column" width="100%">
        <Box justifyContent="space-between">
          <Box>
            {views.map((view, position) => (
              <Tab
                key={view.taskId}
                view={view}
                active={position === index}
                spinner={spinner}
                width={Math.max(10, Math.floor(inner / Math.max(2, views.length)) - 2)}
              />
            ))}
          </Box>
          {views.length > 1 && <Text color={color('ghost')}>Tab {glyph.caret}</Text>}
        </Box>

        <Box>
          <Text color={color('faint')}>
            {truncate(active.model, Math.max(12, inner - 28))}
          </Text>
          <Text color={color('ghost')}>
            {' '}
            {glyph.divider} {active.toolCalls} tool{active.toolCalls === 1 ? '' : 's'}{' '}
            {glyph.divider}{' '}
            {formatDuration((active.endedAt ?? now) - active.startedAt)}
          </Text>
          <Text color={color('ghost')}> {glyph.divider} </Text>
          <Meter
            value={active.contextUsed}
            max={active.contextMax}
            width={4}
            label={`Context ${Math.round((active.contextUsed / Math.max(1, active.contextMax)) * 100)}%`}
          />
        </Box>

        <Box flexDirection="column" marginTop={0}>
          {active.thinkingSince !== null && (
            <Box>
              <Text color={color('info')}>{spinner} </Text>
              <Text color={color('info')}>Thinking</Text>
              <Text color={color('ghost')}>
                {' '}
                {formatDuration(now - active.thinkingSince)}
              </Text>
            </Box>
          )}
          {active.lines.slice(-VISIBLE_LINES).map((line, position) => (
            <ActivityLine key={position} line={line} width={inner} spinner={spinner} />
          ))}
          {/* Only when there is genuinely nothing else on the panel. A
              finished agent shows its conclusion below, and captioning that
              with "no activity recorded" contradicts it. */}
          {active.lines.length === 0 && active.thinkingSince === null && !active.summary && (
            <Text color={color('ghost')} italic>
              {active.status === 'running' ? 'starting…' : 'no activity recorded'}
            </Text>
          )}
        </Box>

        {active.summary && (
          <Box>
            <Text color={color(active.status === 'done' ? 'success' : 'danger')}>
              {active.status === 'done' ? glyph.done : glyph.failed}{' '}
            </Text>
            <Text color={color('muted')}>{truncate(active.summary, inner - 2)}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Tab({
  view,
  active,
  spinner,
  width,
}: {
  view: SubagentView;
  active: boolean;
  spinner: string;
  width: number;
}): React.ReactElement {
  const mark =
    view.status === 'running'
      ? spinner
      : view.status === 'done'
        ? glyph.done
        : glyph.failed;
  const tone =
    view.status === 'running' ? 'accent' : view.status === 'done' ? 'success' : 'danger';

  return (
    <Box marginRight={2}>
      {/*
        The caret, not just bold and underline. Which tab is selected is the
        one thing this strip has to communicate, and a terminal that renders
        neither attribute — a legacy console, a pipe, a screenshot — would show
        three identical tabs and no way to tell which body belongs to which.
      */}
      <Text color={color(active ? 'accent' : 'ghost')}>{active ? glyph.caret : ' '} </Text>
      <Text color={color(tone)}>{mark} </Text>
      <Text color={color(active ? 'text' : 'faint')} bold={active} underline={active}>
        {truncate(view.title, width)}
      </Text>
    </Box>
  );
}

function ActivityLine({
  line,
  width,
  spinner,
}: {
  line: SubagentLine;
  width: number;
  spinner: string;
}): React.ReactElement {
  if (line.kind === 'thinking') {
    return (
      <Box>
        <Text color={color('info')}>{glyph.step} </Text>
        <Text color={color('info')}>
          Thought for {formatDuration(line.durationMs ?? 0)}
        </Text>
      </Box>
    );
  }

  if (line.kind === 'text') {
    return (
      <Box>
        <Text color={color('ghost')}>{glyph.rail} </Text>
        <Text color={color('muted')}>{truncate(line.label, width - 2)}</Text>
      </Box>
    );
  }

  const pending = line.ok === undefined;
  return (
    <Box>
      <Text color={color(pending ? 'accent' : line.ok ? 'success' : 'danger')}>
        {pending ? spinner : line.ok ? glyph.done : glyph.failed}{' '}
      </Text>
      <Text color={color('muted')}>{truncate(line.label, width - 12)}</Text>
      {line.durationMs !== undefined && (
        <Text color={color('ghost')}> {formatDuration(line.durationMs)}</Text>
      )}
    </Box>
  );
}
