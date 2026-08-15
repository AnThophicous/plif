import React from 'react';
import { Box, Text } from 'ink';

import {
  breathingTone,
  semanticWave,
  semanticWaveTone,
  toneBetween,
  useHighlightClock,
} from '../pulse.js';
import { effortVisual } from '../effort-visuals.js';
import { color, layout, supportsRichGlyphs } from '../theme.js';

export interface FocusCell {
  readonly text: string;
  readonly color: string;
}

type Edge = 'top' | 'bottom';

const glyphs = supportsRichGlyphs
  ? {
      topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯',
      midLeft: '├', midRight: '┤', horizontal: '─', vertical: '│',
    }
  : {
      topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+',
      midLeft: '+', midRight: '+', horizontal: '-', vertical: '|',
    };

export function focusRule(
  width: number,
  elapsedMs: number,
  active: boolean,
  edge: Edge = 'top',
  plif = false,
  effort?: string,
): readonly FocusCell[] {
  const size = Math.max(2, Math.floor(width));
  const span = size - 2;
  const origin = span > 0 ? (elapsedMs / 220) % span : 0;
  const stops = effortVisual(effort ?? (plif ? 'plif' : undefined)).stops;
  const endpoint = active
    ? effort || plif
      ? semanticWave(elapsedMs / 1_440 + (edge === 'bottom' ? 0.5 : 0), stops)
      : toneBetween('accent', 'accentBright', 0.9)
    : color('faint');
  const cells: FocusCell[] = [{
    text: edge === 'top' ? glyphs.topLeft : glyphs.bottomLeft,
    color: endpoint,
  }];

  for (let index = 0; index < span; index += 1) {
    const distance = Math.min(
      Math.abs(index - origin),
      Math.abs(index - origin + span),
      Math.abs(index - origin - span),
    );
    const intensity = active ? Math.max(0.08, 1 - distance / Math.max(2, span / 5)) : 0;
    const waveIndex = edge === 'bottom' ? span - index - 1 : index;
    cells.push({
      text: glyphs.horizontal,
      color: active
        ? effort || plif
          ? semanticWaveTone(elapsedMs, waveIndex, span, stops)
          : toneBetween('brand', 'accentBright', intensity)
        : color('faint'),
    });
  }

  cells.push({
    text: edge === 'top' ? glyphs.topRight : glyphs.bottomRight,
    color: endpoint,
  });
  return cells;
}

/**
 * The mark, as cells rather than as a string.
 *
 * Two half-discs back to back read as one loop, so four of them read as the
 * two joined loops of an infinity — wider and heavier than `∞`, which a
 * terminal draws at whatever small size the font decided. Motion is a light
 * travelling the figure rather than a swap between frames: a four-cell glyph
 * that changes shape flickers, while the same glyph relit cell by cell reads
 * as something moving around a track.
 */
export const INFINITY_CELLS = supportsRichGlyphs
  ? ['◖', '◗', '◖', '◗']
  : ['o', 'o', 'o', 'o'];

export function infinityFrame(elapsedMs: number, active: boolean): string {
  void elapsedMs;
  void active;
  return INFINITY_CELLS.join('');
}

export function infinityCells(
  elapsedMs: number,
  active: boolean,
  plif = false,
): readonly FocusCell[] {
  if (!active) {
    return INFINITY_CELLS.map((text) => ({ text, color: color('accentDim') }));
  }
  const span = INFINITY_CELLS.length;
  const origin = (elapsedMs / 300) % span;
  return INFINITY_CELLS.map((text, index) => {
    const distance = Math.min(
      Math.abs(index - origin),
      Math.abs(index - origin + span),
      Math.abs(index - origin - span),
    );
    return {
      text,
      color: plif
        ? semanticWaveTone(elapsedMs, index, span, effortVisual('plif').stops, 1_080)
        : toneBetween('accentDim', 'accentBright', Math.max(0, 1 - distance / 1.6)),
    };
  });
}

export function InfinityMark({ active, plif = false }: { active: boolean; plif?: boolean }): React.ReactElement {
  const elapsed = useHighlightClock(active, 80);
  return (
    <Text bold={active}>
      {infinityCells(elapsed, active, plif).map((cell, index) => (
        <Text key={index} color={cell.color}>{cell.text}</Text>
      ))}
    </Text>
  );
}

/**
 * The prompt frame, optionally with a second compartment under it.
 *
 * The footer is inside the frame rather than a separate box below it, and that
 * is the whole point: a status row floating under a closed box is two objects,
 * and it reads as one of them having come loose. Sharing the walls makes the
 * prompt and its status one solid unit, divided rather than stacked.
 *
 * The divider does not animate. The outer edge carries the motion — that is the
 * identity — and a second moving line inside it would compete with the first
 * and make a two-line panel look busy.
 */
export function FocusFrame({
  children,
  width,
  active,
  footer,
  plif = false,
  effort,
}: {
  readonly children: React.ReactNode;
  readonly width: number;
  readonly active: boolean;
  readonly footer?: React.ReactNode;
  readonly plif?: boolean;
  readonly effort?: string;
}): React.ReactElement {
  const elapsed = useHighlightClock(active, 70);
  const frameWidth = Math.max(8, width);
  const sideColor = active
    ? effort || plif
      ? semanticWave(elapsed / 2_400, effortVisual(effort ?? (plif ? 'plif' : undefined)).stops)
      : breathingTone(elapsed, 'brand', 'accent')
    : color('faint');

  const wall = (body: React.ReactNode): React.ReactElement => (
    <Box width={frameWidth}>
      <Text color={sideColor}>{glyphs.vertical}</Text>
      <Box flexDirection="column" width={frameWidth - 2} paddingX={layout.boxPadX}>
        {body}
      </Box>
      <Text color={sideColor}>{glyphs.vertical}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" width={frameWidth} flexShrink={0}>
      <FocusRule width={frameWidth} elapsed={elapsed} active={active} plif={plif} effort={effort} />
      {wall(children)}
      {footer !== undefined && (
        <>
          <Text color={color('ghost')}>
            {glyphs.midLeft}
            {glyphs.horizontal.repeat(Math.max(0, frameWidth - 2))}
            {glyphs.midRight}
          </Text>
          {wall(footer)}
        </>
      )}
      <FocusRule width={frameWidth} elapsed={elapsed + 300} active={active} edge="bottom" plif={plif} effort={effort} />
    </Box>
  );
}

function FocusRule({
  width,
  elapsed,
  active,
  edge = 'top',
  plif = false,
  effort,
}: {
  readonly width: number;
  readonly elapsed: number;
  readonly active: boolean;
  readonly edge?: Edge;
  readonly plif?: boolean;
  readonly effort?: string;
}): React.ReactElement {
  return (
    <Text>
      {focusRule(width, elapsed, active, edge, plif, effort).map((cell, index) => (
        <Text key={index} color={cell.color}>{cell.text}</Text>
      ))}
    </Text>
  );
}
