import React from 'react';
import { Box, Text } from 'ink';

import { Meter } from './Meter.js';
import { color, formatCount, glyph, layout, shortenPath, truncate } from '../theme.js';

export interface HeaderProps {
  readonly cwd: string;
  readonly model: string | null;
  readonly contextUsed: number;
  readonly contextMax: number;
  /** Token use in independent child windows, not part of the parent window. */
  readonly delegatedTokens?: number;
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
  model,
  contextUsed,
  contextMax,
  delegatedTokens = 0,
  width,
}: HeaderProps): React.ReactElement {
  const narrow = width < layout.narrowWidth;

  const right = (
    <Box>
      {model && !narrow && (
        <>
          <Text color={color('faint')}>{truncate(model, 28)}</Text>
          <Text color={color('ghost')}> {glyph.divider} </Text>
        </>
      )}
      <Meter
        value={contextUsed}
        max={contextMax}
        width={narrow ? 4 : 6}
        label={narrow ? undefined : `Context ${Math.round((contextUsed / Math.max(1, contextMax)) * 100)}%`}
      />
      {delegatedTokens > 0 && !narrow && (
        <Text color={color('ghost')}> {glyph.divider} Agents +{formatCount(delegatedTokens)}</Text>
      )}
    </Box>
  );

  const left = (
    <Box>
      <Text color={color('muted')}>{glyph.caret} </Text>
      <Text color={color('muted')}>{shortenPath(cwd, Math.max(16, Math.floor(width * 0.4)))}</Text>
    </Box>
  );

  return (
    <Box
      width="100%"
      justifyContent="space-between"
    >
      {left}
      {right}
    </Box>
  );
}
