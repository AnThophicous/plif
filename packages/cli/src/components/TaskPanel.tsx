import React from 'react';
import { Box, Text } from 'ink';

import type { TaskSnapshot } from '@plif/core';
import { color, formatDuration, glyph, truncate } from '../theme.js';

export function TaskPanel({ tasks, width }: { tasks: readonly TaskSnapshot[]; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      {tasks.length === 0 ? <Text color={color('muted')}>no background tasks</Text> : tasks.map((task) => {
        const [operation, ...rest] = task.title.split(/\s+/);
        const summary = rest.join(' ') || task.argv.join(' ');
        return (
          <Box key={task.id}>
            <Text color={color(tone(task.status))}>{statusGlyph(task.status)} </Text>
            <Text color={color(task.status === 'running' ? 'accent' : 'muted')} bold>{operation}</Text>
            <Text color={color('muted')}> {truncate(summary, Math.max(12, width - 30))}</Text>
            <Text color={color('ghost')}> {task.status}</Text>
            <Text color={color('ghost')}> {formatDuration(Date.now() - (task.startedAt ?? task.createdAt))}</Text>
          </Box>
        );
      })}
      <Text color={color('faint')}>Ctrl+T or Esc to close</Text>
    </Box>
  );
}

function lastLine(value: string): string {
  return value.trim().split(/\r?\n/).at(-1) ?? '';
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
