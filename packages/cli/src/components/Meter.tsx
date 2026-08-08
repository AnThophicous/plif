import React from 'react';
import { Box, Text } from 'ink';

import { color, glyph } from '../theme.js';

interface MeterProps {
  readonly value: number;
  readonly max: number;
  readonly width?: number;
  /** Text to the right of the bar. Omit for a bare bar. */
  readonly label?: string;
  /** Fill turns warn/danger past these fractions. */
  readonly warnAt?: number;
  readonly dangerAt?: number;
}

/**
 * A compact fill bar.
 *
 * The colour is driven by how full it is, not by what it measures, so a context
 * window at 90% and a disk quota at 90% look equally urgent without any caller
 * having to decide that. Below the warn threshold it stays accent-coloured and
 * visually recedes — a meter that is fine should not draw the eye.
 */
export function Meter({
  value,
  max,
  width = 10,
  label,
  warnAt = 0.75,
  dangerAt = 0.9,
}: MeterProps): React.ReactElement {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * width);

  const tone = ratio >= dangerAt ? 'danger' : ratio >= warnAt ? 'warn' : 'accentDim';

  return (
    <Box>
      <Text color={color(tone)}>{glyph.meterFull.repeat(filled)}</Text>
      <Text color={color('ghost')}>{glyph.meterEmpty.repeat(Math.max(0, width - filled))}</Text>
      {label !== undefined && (
        <Text color={color(ratio >= warnAt ? tone : 'muted')}> {label}</Text>
      )}
    </Box>
  );
}
