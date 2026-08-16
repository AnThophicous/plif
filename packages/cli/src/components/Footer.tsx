import React from 'react';
import { Box, Text } from 'ink';

import { color, glyph, layout } from '../theme.js';

export interface Hint {
  readonly key: string;
  readonly label: string;
}

interface FooterProps {
  readonly hints: readonly Hint[];
  readonly width: number;
  readonly themeRevision?: number;
  /** Right-aligned run summary, e.g. "turn 3 · 12.4s · 2 execs". */
  readonly status?: string;
}

/**
 * The key hint bar.
 *
 * Lifted straight from the reference CLIs, and worth copying because it solves
 * a real problem: a keyboard-driven interface with no visible affordances is
 * unlearnable, but a help screen is unread. Hints on screen at all times cost
 * one line and remove the need for both.
 *
 * The keys are the bright part and the labels are dim, so the bar compresses
 * into a scannable row of keys when you already know what they do.
 */
export const Footer = React.memo(function Footer({ hints, width, status }: FooterProps): React.ReactElement {
  const narrow = width < layout.narrowWidth;
  const shown = narrow ? hints.slice(0, 2) : hints;

  return (
    <Box width="100%" paddingX={layout.gutter} justifyContent="space-between">
      <Box>
        {shown.map((hint, index) => (
          <Box key={hint.key}>
            {index > 0 && <Text color={color('ghost')}> {glyph.divider} </Text>}
            <Text color={color('muted')} bold>
              {hint.key}
            </Text>
            <Text color={color('muted')}>:{hint.label}</Text>
          </Box>
        ))}
      </Box>
      {status && !narrow && <Text color={color('ghost')}>{status}</Text>}
    </Box>
  );
});
