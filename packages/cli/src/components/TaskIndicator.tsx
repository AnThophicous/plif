import React from 'react';
import { Box, Text } from 'ink';

import type { TaskSnapshot } from '@plif/core';
import { color, glyph, truncate } from '../theme.js';

export function TaskIndicator({ tasks, width }: { tasks: readonly TaskSnapshot[]; width: number }): React.ReactElement | null {
  if (tasks.length === 0) return null;
  const active = tasks.filter((task) => task.status === 'running' || task.status === 'awaiting_approval').length;
  const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').length;
  const label = `${glyph.task} tasks ${active} active` + (failed ? ` ${failed} attention` : '');
  return (
    <Box paddingX={1} width="100%" justifyContent="space-between">
      <Text color={color(failed ? 'warn' : 'accent')}>{label}</Text>
      <Text color={color('faint')}>{truncate('press t to expand', Math.max(16, width - label.length - 4))}</Text>
    </Box>
  );
}
