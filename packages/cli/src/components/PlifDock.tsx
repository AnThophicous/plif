import React from 'react';
import { Box, Text } from 'ink';

import { effortSymbol, effortTagline, effortVisual } from '../effort-visuals.js';
import { color, layout, shortenPath, truncate } from '../theme.js';
import { Meter } from './Meter.js';
export { plifDockItems } from '../live-status.js';

const DOCK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode', 'plif'] as const;

/** One row for the dock, one for the divider that joins it to the prompt. */
export function plifDockHeight(effort?: string): number {
  return DOCK_EFFORTS.includes(effort as (typeof DOCK_EFFORTS)[number]) ? 2 : 0;
}

export function PlifDock({
  cwd,
  model,
  effort,
  contextUsed,
  contextMax,
  working,
  transitioning = false,
  animated: ambientAnimation = false,
  width,
}: {
  readonly cwd: string;
  /** Active provider model, shown immediately before the context meter. */
  readonly model?: string;
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
  if (plifDockHeight(effort) === 0) return null;

  const identitySymbol = effortSymbol(effort);
  const inner = Math.max(18, width - 4);
  const narrow = inner < layout.narrowWidth;
  const compact = inner < 28;
  const percent = Math.round((contextUsed / Math.max(1, contextMax)) * 100);
  const modelWidth = compact
    ? Math.max(3, inner - 21)
    : Math.min(28, Math.max(12, Math.floor(inner * 0.28)));
  const modelLabel = model?.trim() ? truncate(model.trim(), modelWidth) : '';
  const pathWidth = Math.max(10, inner - 32 - (modelLabel ? modelWidth + 4 : 0));

  return (
    <Box width="100%" justifyContent="space-between" flexWrap="nowrap">
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {compact ? (
          <Text color={color(animated ? 'accentBright' : 'muted')} bold wrap="truncate">{` ${identitySymbol} ${visual.label.slice(0, 8)}`}</Text>
        ) : (
          <Text bold>
            {identitySymbol && <Text color={color(animated ? 'accentBright' : 'muted')}>{` ${identitySymbol} `}</Text>}
            <Text color={color(animated ? 'accentBright' : 'muted')}>{visual.label}</Text>
          </Text>
        )}
        {animated && !compact && <Text color={color('muted')}>{` · ${effortTagline(effort, working)}`}</Text>}
        {!narrow && (
          <Text color={color(working ? 'muted' : 'faint')}>
            {`  ·  ${truncate(shortenPath(cwd, pathWidth), pathWidth)}${animated ? `  ·  ${visual.descriptor}` : ''}`}
          </Text>
        )}
      </Box>
      <Box marginLeft={1} flexShrink={1}>
        {modelLabel && (
          <Text color={color('text')} bold>
            {modelLabel}
          </Text>
        )}
        {modelLabel && !compact && <Text color={color('ghost')}> {'·'} </Text>}
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
