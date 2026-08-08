import React from 'react';
import { Box, Text } from 'ink';

import { Meter } from './Meter.js';
import { color, formatCount, glyph, layout, shortenPath, truncate } from '../theme.js';

export interface HeaderProps {
  readonly cwd: string;
  /** Container the input is currently aimed at. */
  readonly container: string | null;
  readonly containerState: string | null;
  /** Sandbox isolation level, shown as a trust badge. */
  readonly isolation: string;
  readonly degraded: boolean;
  readonly model: string | null;
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly width: number;
}

/**
 * The status line.
 *
 * Modelled on the reference CLIs: location on the left, budget on the right,
 * nothing in between. The one addition is the isolation badge, because in a
 * container-native agent the single most important thing a developer needs at a
 * glance is *how confined is the thing about to run my commands* — and if the
 * answer is "barely", that must be impossible to miss rather than buried in a
 * log line at startup.
 */
export function Header({
  cwd,
  container,
  containerState,
  isolation,
  degraded,
  model,
  contextUsed,
  contextMax,
  width,
}: HeaderProps): React.ReactElement {
  const narrow = width < layout.narrowWidth;

  const stateTone =
    containerState === 'running'
      ? 'success'
      : containerState === 'exited'
        ? 'faint'
        : containerState === null
          ? 'ghost'
          : 'warn';

  // The badge is the loudest element on screen when isolation is weak, and
  // recedes to a dim label when it is strong. Safety should be boring.
  const isolationTone = isolation === 'none' ? 'danger' : degraded ? 'warn' : 'muted';

  const right = (
    <Box>
      {model && !narrow && (
        <>
          <Text color={color('faint')}>{truncate(model, 28)}</Text>
          <Text color={color('ghost')}> {glyph.divider} </Text>
        </>
      )}
      <Text color={color(isolationTone)}>
        {isolation === 'none' ? glyph.locked : glyph.container} {isolation}
      </Text>
      {!narrow && (
        <>
          <Text color={color('ghost')}> {glyph.divider} </Text>
          <Meter
            value={contextUsed}
            max={contextMax}
            width={8}
            label={`${formatCount(contextUsed)}/${formatCount(contextMax)}`}
          />
        </>
      )}
    </Box>
  );

  const left = (
    <Box>
      <Text color={color('accent')}>{glyph.caret} </Text>
      <Text color={color('muted')}>{shortenPath(cwd, Math.max(16, Math.floor(width * 0.4)))}</Text>
      {container && (
        <>
          <Text color={color('ghost')}> {glyph.divider} </Text>
          <Text color={color(stateTone)}>{glyph.active} </Text>
          <Text color={color('text')}>{container}</Text>
        </>
      )}
    </Box>
  );

  return (
    <Box
      width="100%"
      paddingX={layout.gutter}
      justifyContent="space-between"
      marginBottom={1}
    >
      {left}
      {right}
    </Box>
  );
}
