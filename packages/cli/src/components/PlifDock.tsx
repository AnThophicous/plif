import React from 'react';
import { Box, Text } from 'ink';

import { InfinityMark } from './FocusFrame.js';
import { Meter } from './Meter.js';
import { color, layout, shortenPath, truncate } from '../theme.js';
export { plifDockItems } from '../live-status.js';

/** One row for the dock, one for the divider that joins it to the prompt. */
export function plifDockHeight(effort?: string): number {
  return effort === 'plif' ? 2 : 0;
}

export function PlifDock({
  cwd,
  effort,
  contextUsed,
  contextMax,
  working,
  width,
}: {
  readonly cwd: string;
  readonly effort?: string;
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly working: boolean;
  readonly width: number;
}): React.ReactElement | null {
  if (effort !== 'plif') return null;

  const inner = Math.max(18, width - 4);
  const narrow = inner < layout.narrowWidth;
  const percent = Math.round((contextUsed / Math.max(1, contextMax)) * 100);
  // The path gets whatever the meter and the mark leave. It is the only thing
  // here that varies in length, so it is the only thing that should absorb the
  // slack rather than being given a fixed share of it.
  const pathWidth = Math.max(10, inner - (narrow ? 16 : 32));

  // No border and no margin of its own: this is rendered inside the prompt
  // frame, below its divider, so the walls and the padding are already there.
  // No labels either — a "working" word beside a mark that is already moving,
  // or a "Plif" badge under a frame that is already the Plif frame, was the
  // same thing said twice.
  return (
    <Box width="100%" justifyContent="space-between">
      <Box flexShrink={1}>
        <InfinityMark active={working} />
        <Text color={color(working ? 'muted' : 'faint')}>
          {working ? ' working' : ' ready'}
          {'  ·  '}
          {truncate(shortenPath(cwd, pathWidth), pathWidth)}
          {!narrow && '  ·  Plif'}
        </Text>
      </Box>
      <Box marginLeft={1}>
        <Text color={color('muted')}>{narrow ? 'Context ' : '  ·  Context '}</Text>
        <Text color={color('ghost')}>[</Text>
        <Meter value={contextUsed} max={contextMax} width={narrow ? 4 : 6} />
        <Text color={color('ghost')}>]</Text>
        {!narrow && <Text color={color('muted')}> {percent}%</Text>}
      </Box>
    </Box>
  );
}
