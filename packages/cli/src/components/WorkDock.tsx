import React from 'react';
import { Box, Text } from 'ink';

import type { TaskSnapshot } from '@plif/core';

import { useSpinnerFrame } from './Spinner.js';
import type { SubagentView } from '../session.js';
import { color, formatDuration, glyph, layout, truncate } from '../theme.js';

export function workDockHeight(
  tasks: readonly TaskSnapshot[],
  subagents: readonly SubagentView[],
  expanded: boolean,
): number {
  if (tasks.length === 0 && subagents.length === 0) return 0;
  if (!expanded) return 1;
  return 3 + Math.min(tasks.length, 4) + Math.min(subagents.length, 3) + (tasks.length > 4 ? 1 : 0) + (subagents.length > 3 ? 1 : 0) + (subagents.length > 0 ? 1 : 0);
}

export function WorkDock({
  tasks,
  subagents,
  subagentFocus,
  expanded,
  width,
  now,
}: {
  readonly tasks: readonly TaskSnapshot[];
  readonly subagents: readonly SubagentView[];
  readonly subagentFocus: number;
  readonly expanded: boolean;
  readonly width: number;
  readonly now: number;
}): React.ReactElement | null {
  if (tasks.length === 0 && subagents.length === 0) return null;

  const active = tasks.filter((task) => task.status === 'running' || task.status === 'awaiting_approval').length;
  const spinner = useSpinnerFrame(80, active > 0 || subagents.some((agent) => agent.status === 'running'));
  const label = [
    tasks.length > 0 ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : null,
    subagents.length > 0 ? `${subagents.length} agent${subagents.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(` ${glyph.divider} `);
  const inner = Math.max(18, width - layout.gutter * 2 - 4);

  if (!expanded) {
    return (
      <Box paddingX={layout.gutter} width="100%">
        <Text color={color('ghost')}>{glyph.caret} </Text>
        <Text color={color('muted')} bold>Work</Text>
        <Text color={color('ghost')}> {label} </Text>
        <Text color={color('accent')}>{spinner}</Text>
        <Text color={color('ghost')}> {glyph.divider} Ctrl+T open</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={layout.gutter} width="100%">
      <Box flexDirection="column" borderStyle="round" borderColor={color('faint')} paddingX={1} width="100%">
        <Box justifyContent="space-between">
          <Box>
            <Text color={color('accent')}>{glyph.caret} </Text>
            <Text color={color('text')} bold>Work</Text>
            <Text color={color('ghost')}> {label}</Text>
          </Box>
          <Text color={color('ghost')}>Ctrl+T close</Text>
        </Box>
        {tasks.slice(0, 4).map((task) => (
          <TaskLine key={task.id} task={task} spinner={spinner} width={inner} now={now} />
        ))}
        {tasks.length > 4 && <Text color={color('ghost')}>{`  ${glyph.rail} +${tasks.length - 4} more tasks`}</Text>}
        {subagents.slice(0, 3).map((agent, index) => (
          <AgentLine
            key={agent.taskId}
            agent={agent}
            selected={index === subagentFocus}
            spinner={spinner}
            width={inner}
            now={now}
          />
        ))}
        {subagents.length > 3 && <Text color={color('ghost')}>{`  ${glyph.rail} +${subagents.length - 3} more agents`}</Text>}
        {subagents.length > 0 && <Text color={color('ghost')}>Tab select {glyph.divider} Ctrl+S inspect {glyph.divider} Ctrl+X stop</Text>}
      </Box>
    </Box>
  );
}

function TaskLine({
  task,
  spinner,
  width,
  now,
}: {
  readonly task: TaskSnapshot;
  readonly spinner: string;
  readonly width: number;
  readonly now: number;
}): React.ReactElement {
  const running = task.status === 'running';
  const tone = task.status === 'awaiting_approval' ? 'warn' : running ? 'accent' : task.status === 'failed' || task.status === 'blocked' ? 'danger' : 'muted';
  const marker = running ? spinner : task.status === 'awaiting_approval' ? glyph.waiting : task.status === 'done' ? glyph.done : glyph.failed;
  const elapsed = now - (task.startedAt ?? task.createdAt);
  return (
    <Box>
      <Text color={color(tone)}> {marker} </Text>
      <Text color={color('muted')}>$ </Text>
      <Text color={color(running ? 'text' : 'muted')}>{truncate(task.title, Math.max(10, width - 18))}</Text>
      <Text color={color('ghost')}> {formatDuration(elapsed)}</Text>
    </Box>
  );
}

function AgentLine({
  agent,
  selected,
  spinner,
  width,
  now,
}: {
  readonly agent: SubagentView;
  readonly selected: boolean;
  readonly spinner: string;
  readonly width: number;
  readonly now: number;
}): React.ReactElement {
  const running = agent.status === 'running';
  const recent = agent.lines.at(-1)?.label;
  const label = recent ? `${agent.title} ${glyph.divider} ${recent}` : agent.title;
  return (
    <Box>
      <Text color={color(running ? 'accent' : 'ghost')}> {running ? spinner : glyph.done} </Text>
      <Text color={color(selected ? 'accentBright' : 'muted')} bold={selected}>{glyph.agent} </Text>
      <Text color={color(selected ? 'text' : 'muted')}>{truncate(label, Math.max(10, width - 18))}</Text>
      <Text color={color('ghost')}> {formatDuration(now - agent.startedAt)}</Text>
    </Box>
  );
}
