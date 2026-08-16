import React from 'react';
import { Text } from 'ink';

import { clusterLength } from '../text.js';
import {
  PLIF_WAVE_STOPS,
  semanticWaveTone,
  type SemanticWaveStops,
} from '../pulse.js';
import { color, type PaletteKey } from '../theme.js';

export interface PlifGlowCell {
  readonly text: string;
  readonly color: string;
}

/**
 * Split a string into terminal graphemes and colour each one independently.
 * The text is never replaced, padded, truncated, or re-ordered: animation is
 * consequently a paint change only, even for joined emoji and combining text.
 */
export function plifGlowCells(
  value: string,
  elapsedMs: number,
  active = true,
  stops: SemanticWaveStops = PLIF_WAVE_STOPS,
): readonly PlifGlowCell[] {
  const cells: string[] = [];
  for (let at = 0; at < value.length; ) {
    const length = clusterLength(value, at) || 1;
    cells.push(value.slice(at, at + length));
    at += length;
  }
  if (cells.length === 0) return [];

  return cells.map((text, index) => ({
    text,
    color: active
      ? semanticWaveTone(elapsedMs, index, cells.length, stops)
      : color('text'),
  }));
}

export interface PlifGlowProps {
  readonly value: string;
  readonly elapsedMs: number;
  readonly active?: boolean;
  readonly bold?: boolean;
  readonly fallback?: PaletteKey;
  readonly stops?: SemanticWaveStops;
}

/** Render a stable string with a travelling semantic colour wave. */
export function PlifGlow({
  value,
  elapsedMs,
  active = true,
  bold,
  fallback = 'text',
  stops = PLIF_WAVE_STOPS,
}: PlifGlowProps): React.ReactElement {
  const cells = plifGlowCells(value, elapsedMs, active, stops);
  return (
    <Text bold={bold}>
      {cells.map((cell, index) => (
        <Text key={index} color={active ? cell.color : color(fallback)}>
          {cell.text}
        </Text>
      ))}
    </Text>
  );
}
