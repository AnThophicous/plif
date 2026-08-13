import React from 'react';
import { Box, Text } from 'ink';

import { breathingTone, toneBetween, useHighlightClock } from '../pulse.js';
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
): readonly FocusCell[] {
  const size = Math.max(2, Math.floor(width));
  const span = size - 2;
  const origin = span > 0 ? (elapsedMs / 70) % span : 0;
  const endpoint = active ? toneBetween('accent', 'accentBright', 0.9) : color('faint');
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
    cells.push({
      text: glyphs.horizontal,
      color: active ? toneBetween('brand', 'accentBright', intensity) : color('faint'),
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

export function infinityCells(elapsedMs: number, active: boolean): readonly FocusCell[] {
  if (!active) {
    return INFINITY_CELLS.map((text) => ({ text, color: color('accentDim') }));
  }
  const span = INFINITY_CELLS.length;
  const origin = (elapsedMs / 150) % span;
  return INFINITY_CELLS.map((text, index) => {
    const distance = Math.min(
      Math.abs(index - origin),
      Math.abs(index - origin + span),
      Math.abs(index - origin - span),
    );
    return {
      text,
      color: toneBetween('accentDim', 'accentBright', Math.max(0, 1 - distance / 1.6)),
    };
  });
}

export function InfinityMark({ active }: { active: boolean }): React.ReactElement {
  const elapsed = useHighlightClock(active, 80);
  return (
    <Text bold={active}>
      {infinityCells(elapsed, active).map((cell, index) => (
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
}: {
  readonly children: React.ReactNode;
  readonly width: number;
  readonly active: boolean;
  readonly footer?: React.ReactNode;
}): React.ReactElement {
  const elapsed = useHighlightClock(active, 70);
  const frameWidth = Math.max(8, width);
  const sideColor = active ? breathingTone(elapsed, 'brand', 'accent') : color('faint');

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
    <Box flexDirection="column" width={frameWidth}>
      <FocusRule width={frameWidth} elapsed={elapsed} active={active} />
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
      <FocusRule width={frameWidth} elapsed={elapsed + 300} active={active} edge="bottom" />
    </Box>
  );
}

function FocusRule({
  width,
  elapsed,
  active,
  edge = 'top',
}: {
  readonly width: number;
  readonly elapsed: number;
  readonly active: boolean;
  readonly edge?: Edge;
}): React.ReactElement {
  return (
    <Text>
      {focusRule(width, elapsed, active, edge).map((cell, index) => (
        <Text key={index} color={cell.color}>{cell.text}</Text>
      ))}
    </Text>
  );
}
