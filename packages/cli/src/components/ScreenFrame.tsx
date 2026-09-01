import React from 'react';
import { Box, Text } from '../ui.js';

import { displayWidth } from '../text.js';
import { color, layout, truncate } from '../theme.js';

export interface ScreenFrameProps {
  /** The screen's name. Shown upper-case; it is the only thing on the left. */
  readonly title: string;
  /** Right-aligned context for the title row: a count, a provider, a state. */
  readonly badge?: string;
  /** One quiet line under the rule, when the screen needs to explain itself. */
  readonly subtitle?: string;
  /** The key bar. Every key the screen answers to belongs here, and only here. */
  readonly keys: readonly string[];
  readonly width: number;
  readonly rows: number;
  readonly children: React.ReactNode;
}

/**
 * The chrome every full-screen view shares.
 *
 * Plif has several screens that take over the terminal — status, config, usage,
 * agents, sessions — and before this they each drew their own heading, their own
 * rule and their own key hints, at their own indents. The result read as five
 * tools rather than one. This is the single frame: a name on the left, its
 * context on the right, one rule, the body, and a key bar pinned to the bottom.
 *
 * It is deliberately light. A full box border costs two columns, two rows and a
 * great deal of visual weight to say something the rule already says, and every
 * cell it draws is a cell the renderer measures on every frame.
 */
export function ScreenFrame({
  title,
  badge,
  subtitle,
  keys,
  width,
  rows,
  children,
}: ScreenFrameProps): React.ReactElement {
  const contentWidth = Math.max(1, width - layout.gutter * 2);
  const height = Math.max(6, rows - 1);
  const heading = title.toUpperCase();
  // The rule continues the title rather than restarting under it, so the eye
  // reads one horizontal line with a name sitting on it.
  const railWidth = Math.max(
    0,
    contentWidth - displayWidth(heading) - (badge ? displayWidth(badge) + 2 : 0) - 2,
  );

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={layout.gutter}>
      <Box width={contentWidth}>
        <Text color={color('accentBright')} bold>{heading}</Text>
        <Text color={color('ghost')}>{` ${'─'.repeat(railWidth)} `}</Text>
        {badge !== undefined && (
          <Text color={color('muted')}>{truncate(badge, Math.max(4, contentWidth / 2))}</Text>
        )}
      </Box>
      {subtitle !== undefined && (
        <Text color={color('faint')}>{truncate(subtitle, contentWidth)}</Text>
      )}

      <Box flexDirection="column" marginTop={1} width={contentWidth}>
        {children}
      </Box>

      <Box flexGrow={1} />
      <Text color={color('ghost')}>{truncate(keys.join('  ·  '), contentWidth)}</Text>
    </Box>
  );
}

/**
 * A horizontal meter.
 *
 * Shared by every screen that shows a proportion, so a bar means the same
 * thing in usage as it does in the footer. The filled span carries the tone;
 * the track stays at ghost so a nearly empty meter still reads as a meter.
 */
export function Meter({
  value,
  max,
  cells = 16,
  tone = 'accentBright',
}: {
  readonly value: number;
  readonly max: number;
  readonly cells?: number;
  readonly tone?: Parameters<typeof color>[0];
}): React.ReactElement {
  const size = Math.max(4, Math.floor(cells));
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return (
    <Text>
      <Text color={color(tone)}>{'█'.repeat(filled)}</Text>
      <Text color={color('ghost')}>{'░'.repeat(size - filled)}</Text>
    </Text>
  );
}

/**
 * One padded cell.
 *
 * Screens lay their columns out as fixed-width strings rather than as nested
 * flex boxes: a row whose parts size themselves re-flows as soon as one value
 * is a character too long, and then the whole table steps sideways.
 */
export function cell(value: string, cells: number): string {
  const width = Math.max(0, Math.floor(cells));
  const clipped = truncate(value, width);
  return clipped + ' '.repeat(Math.max(0, width - displayWidth(clipped)));
}

/** The same cell, pushed to the right edge of its column. */
export function rightCell(value: string, cells: number): string {
  const width = Math.max(0, Math.floor(cells));
  const clipped = truncate(value, width);
  return ' '.repeat(Math.max(0, width - displayWidth(clipped))) + clipped;
}

/** A quiet section label inside a screen body. */
export function SectionLabel({ children }: { readonly children: string }): React.ReactElement {
  return <Text color={color('accentDim')} bold>{children}</Text>;
}
