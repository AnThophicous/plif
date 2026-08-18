import React from 'react';
import { Box, Text } from 'ink';

import {
  semanticWaveTone,
  toneBetween,
  useBreath,
} from '../pulse.js';
import { effortTone, effortVisual } from '../effort-visuals.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from '../hooks/useAnimationClock.js';
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
  idleBreath = 0,
): readonly FocusCell[] {
  const size = Math.max(2, Math.floor(width));
  const span = size - 2;
  void elapsedMs;
  const borderEffort = effort ?? (plif ? 'plif' : undefined);
  // The input frame is structural chrome, not a progress bar. Keep one solid
  // effort colour across the rule so it cannot read as an accidental
  // gold-to-blue/purple gradient or trigger a high-frequency repaint.
  const activeColor = color(borderEffort ? effortTone(borderEffort) : 'accentBright');
  // An idle frame is not a dead frame: while the prompt holds focus it inhales
  // slowly between the two quietest structural tones. Geometry never changes,
  // so the frame breathes without shaking the rows it holds.
  const idle = toneBetween('faint', 'muted', Math.min(0.6, idleBreath * 0.6));
  const endpoint = active
    ? activeColor
    : idle;
  const cells: FocusCell[] = [{
    text: edge === 'top' ? glyphs.topLeft : glyphs.bottomLeft,
    color: endpoint,
  }];

  for (let index = 0; index < span; index += 1) {
    cells.push({
      text: glyphs.horizontal,
      color: active ? activeColor : idle,
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
  const elapsed = useAnimationFrame(active, 'slow') * ANIMATION_INTERVAL_MS;
  return (
    <Text bold={active}>
      {infinityCells(elapsed, active, plif).map((cell, index) => (
        <Text key={index} color={cell.color}>{cell.text}</Text>
      ))}
    </Text>
  );
}

/**
 * The prompt is the one deliberately rounded surface in the shell. Its border
 * carries a restrained luminance pulse while the conversation stays open and
 * unboxed around it.
 */
export function FocusFrame({
  children,
  width,
  active,
  footer,
  plif = false,
  effort,
  breathing = false,
}: {
  readonly children: React.ReactNode;
  readonly width: number;
  readonly active: boolean;
  readonly footer?: React.ReactNode;
  readonly plif?: boolean;
  readonly effort?: string;
  /** Let an idle frame inhale slowly instead of sitting flat. */
  readonly breathing?: boolean;
}): React.ReactElement {
  const frameWidth = Math.max(8, width);
  const contentWidth = Math.max(1, frameWidth - 2);

  return (
    <Box
      flexDirection="column"
      width={frameWidth}
      flexShrink={0}
    >
      <AnimatedFocusBorder
        width={frameWidth}
        active={active}
        breathing={breathing}
        edge="top"
        plif={plif}
        effort={effort}
      />
      <Box width={frameWidth} flexShrink={0}>
        <Text color={color('faint')}>{glyphs.vertical}</Text>
        <Box flexDirection="column" width={contentWidth} paddingX={layout.gutter} paddingY={0}>
          <Box width="100%">{children}</Box>
          {footer !== undefined && <Box width="100%">{footer}</Box>}
        </Box>
        <Text color={color('faint')}>{glyphs.vertical}</Text>
      </Box>
      <AnimatedFocusBorder
        width={frameWidth}
        active={active}
        breathing={breathing}
        edge="bottom"
        plif={plif}
        effort={effort}
      />
    </Box>
  );
}

/**
 * Border animation is its own subscription. The body of the prompt never
 * re-renders just because a highlight moved along the top or bottom rule.
 */
const AnimatedFocusBorder = React.memo(function AnimatedFocusBorder({
  width,
  active,
  breathing,
  edge,
  plif,
  effort,
}: {
  readonly width: number;
  readonly active: boolean;
  readonly breathing: boolean;
  readonly edge: Edge;
  readonly plif: boolean;
  readonly effort?: string;
}): React.ReactElement {
  const breath = useBreath(breathing && !active);
  const cells = focusRule(width, 0, active, edge, plif, effort, breath);
  return (
    <Text>
      {cells.map((cell, index) => <Text key={index} color={cell.color}>{cell.text}</Text>)}
    </Text>
  );
});

/** Draw only the horizontal span from the existing closed-frame geometry. */
function OpenFocusRule({
  width,
  elapsed,
  active,
  edge = 'top',
  plif = false,
  effort,
  breath = 0,
}: {
  readonly width: number;
  readonly elapsed: number;
  readonly active: boolean;
  readonly edge?: Edge;
  readonly plif?: boolean;
  readonly effort?: string;
  readonly breath?: number;
}): React.ReactElement {
  const cells = focusRule(Math.max(2, width + 2), elapsed, active, edge, plif, effort, breath).slice(1, -1);
  return (
    <Text>
      {cells.map((cell, index) => <Text key={index} color={cell.color}>{cell.text}</Text>)}
    </Text>
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
