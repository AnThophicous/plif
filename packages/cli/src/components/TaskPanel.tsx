import React from 'react';
import { Box, Text } from '../ui.js';

import type { TaskSnapshot } from '@plif/core';
import { useSpinnerFrame } from './Spinner.js';
import { color, formatDuration, glyph, layout, truncate } from '../theme.js';

export function TaskPanel({ tasks, width }: { tasks: readonly TaskSnapshot[]; width: number }): React.ReactElement {
  const active = tasks.some((task) => task.status === 'running');
  const spinner = useSpinnerFrame(80, active);
  return (
    <Box flexDirection="column" paddingX={layout.gutter} width="100%">
      <Box width="100%" justifyContent="space-between">
        <Text color={color('muted')} bold>{glyph.disclosure} Tasks {tasks.length}</Text>
        <Text color={color('ghost')}>Ctrl+S close</Text>
      </Box>
      {tasks.map((task) => (
        <TaskPanelLine key={task.id} task={task} spinner={spinner} width={Math.max(18, width - layout.gutter * 2)} />
      ))}
      <Text color={color('faint')}>Ctrl+S or Esc to close</Text>
    </Box>
  );
}

function TaskPanelLine({ task, spinner, width }: { task: TaskSnapshot; spinner: string; width: number }): React.ReactElement {
  const toneName = tone(task.status);
  const status = `[${shortStatus(task.status)}]`;
  const elapsed = formatDuration(Date.now() - (task.startedAt ?? task.createdAt));
  const statusWidth = elapsed.length + status.length + 2;
  const titleWidth = Math.max(10, width - statusWidth - 3);
  return (
    <Box width="100%" justifyContent="space-between">
      <Box width={titleWidth} flexShrink={1}>
        <Text color={color(toneName)}>{task.status === 'running' ? spinner : statusGlyph(task.status)} </Text>
        <Text color={color('muted')}>Task </Text>
        <Text color={color(task.status === 'running' ? 'text' : 'muted')} wrap="truncate">
          {truncate(task.title, Math.max(8, titleWidth - 7))}
        </Text>
      </Box>
      <Text color={color(toneName)}>{elapsed} <Text color={color('ghost')}>{status}</Text></Text>
    </Box>
  );
}

function tone(status: TaskSnapshot['status']): 'accent' | 'success' | 'warn' | 'danger' | 'muted' {
  if (status === 'running') return 'accent';
  if (status === 'done') return 'success';
  if (status === 'awaiting_approval') return 'warn';
  if (status === 'failed' || status === 'blocked') return 'danger';
  return 'muted';
}

function statusGlyph(status: TaskSnapshot['status']): string {
  if (status === 'running') return glyph.active;
  if (status === 'done') return glyph.done;
  if (status === 'awaiting_approval') return glyph.waiting;
  if (status === 'failed' || status === 'blocked') return glyph.failed;
  return glyph.pending;
}

function shortStatus(status: TaskSnapshot['status']): string {
  if (status === 'running') return 'run';
  if (status === 'awaiting_approval') return 'wait';
  if (status === 'done') return 'done';
  if (status === 'failed' || status === 'blocked') return 'fail';
  return 'idle';
}
