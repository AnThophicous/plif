import React from 'react';
import { Box, Text } from 'ink';

import { effortPulseCells, effortTagline, effortVisual } from '../effort-visuals.js';
import { useHighlightClock } from '../pulse.js';
import { color, layout, shortenPath, truncate } from '../theme.js';
import { InfinityMark } from './FocusFrame.js';
import { Meter } from './Meter.js';
import { PlifGlow } from './PlifGlow.js';
export { plifDockItems } from '../live-status.js';

/** One row for the dock, one for the divider that joins it to the prompt. */
export function plifDockHeight(effort?: string): number {
  return ['plif', 'max', 'ultra', 'ultracode'].includes(effort ?? '') ? 2 : 0;
}

export function PlifDock({
  cwd,
  effort,
  contextUsed,
  contextMax,
  working,
  transitioning = false,
  animated: ambientAnimation = false,
  width,
}: {
  readonly cwd: string;
  readonly effort?: string;
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly working: boolean;
  readonly transitioning?: boolean;
  readonly animated?: boolean;
  readonly width: number;
}): React.ReactElement | null {
  const plif = effort === 'plif';
  const visual = effortVisual(effort);
  const animated = working || transitioning || ambientAnimation;
  const elapsed = useHighlightClock(animated);
  if (!['plif', 'max', 'ultra', 'ultracode'].includes(effort ?? '')) return null;

  const pulse = effortPulseCells(effort, elapsed, animated);
  const inner = Math.max(18, width - 4);
  const narrow = inner < layout.narrowWidth;
  const compact = inner < 28;
  const percent = Math.round((contextUsed / Math.max(1, contextMax)) * 100);
  const pathWidth = Math.max(10, inner - 32);

  return (
    <Box width="100%" justifyContent="space-between">
      <Box flexShrink={1}>
        <InfinityMark active={animated} plif={plif} />
        {compact ? (
          <Text color={color('faint')} bold>{` ${visual.label.slice(0, 8)}`}</Text>
        ) : (
          <Text bold>
            {' '}
            <PlifGlow
              value={visual.label}
              elapsedMs={elapsed}
              active={animated}
              fallback="faint"
              stops={visual.stops}
            />
          </Text>
        )}
        {animated && !compact && <Text color={color('muted')}>{` · ${effortTagline(effort, working)}`}</Text>}
        {animated && (
          <Text>
            {' '}
            {pulse.map((cell, index) => (
              <Text key={index} color={cell.color}>{cell.text}</Text>
            ))}
          </Text>
        )}
        {!narrow && (
          <Text color={color(working ? 'muted' : 'faint')}>
            {`  ·  ${truncate(shortenPath(cwd, pathWidth), pathWidth)}${animated ? `  ·  ${visual.descriptor}` : ''}`}
          </Text>
        )}
      </Box>
      <Box marginLeft={1}>
        {!compact && <Text color={color('muted')}>{narrow ? 'Context ' : '  ·  Context '}</Text>}
        <Text color={color('ghost')}>[</Text>
        <Meter
          value={contextUsed}
          max={contextMax}
          width={narrow ? 4 : 6}
          plif={plif}
          active={animated}
        />
        <Text color={color('ghost')}>]</Text>
        {!narrow && <Text color={color('muted')}> {percent}%</Text>}
      </Box>
    </Box>
  );
}
