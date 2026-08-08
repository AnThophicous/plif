import React from 'react';
import { Box, Text } from 'ink';

import type { TaskSnapshot } from '@plif/core';
import { color, glyph, truncate } from '../theme.js';

export function TaskPanel({ tasks, width }: { tasks: readonly TaskSnapshot[]; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color('brand')} paddingX={1} marginX={1}>
      <Text color={color('accent')}>background tasks</Text>
      {tasks.length === 0 ? <Text color={color('muted')}>no tasks</Text> : tasks.map((task) => (
        <Box key={task.id} flexDirection="column" marginTop={1}>
          <Text color={color(tone(task.status))}>
            {statusGlyph(task.status)} {task.id} {task.title} ({task.status})
          </Text>
          <Text color={color('muted')}>{truncate(task.argv.join(' '), Math.max(20, width - 6))}</Text>
          {task.stdout && <Text color={color('faint')}>{truncate(`out: ${lastLine(task.stdout)}`, Math.max(20, width - 6))}</Text>}
          {task.stderr && <Text color={color('warn')}>{truncate(`err: ${lastLine(task.stderr)}`, Math.max(20, width - 6))}</Text>}
          {task.error && <Text color={color('danger')}>{truncate(task.error, Math.max(20, width - 6))}</Text>}
        </Box>
      ))}
      <Text color={color('faint')}>t or Esc to close</Text>
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
