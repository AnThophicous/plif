import React from 'react';
import { Box, Text } from 'ink';

import { color } from '../theme.js';
import { PNG_HEADER_ART_HEIGHT, PngHeaderArt } from './PngHeaderArt.js';

export const HEADER_MAX_WIDTH = 68;
const MIN_SPLIT_WIDTH = 56;
const HEADER_TOP_SPACE = 1;
const HEADER_WORDMARK_GAP = 1;
const HEADER_BOTTOM_SPACE = 1;
const HEADER_CARD_PADDING_Y = 1;
const HEADER_BORDER_ROWS = 2;

/** Width reserved for the centered startup identity within the terminal. */
export function headerWidth(width: number): number {
  return Math.min(HEADER_MAX_WIDTH, Math.max(1, Math.floor(width)));
}

/**
 * Rows occupied by the quiet startup identity, including its outline and
 * breathing margins.
 *
 * Runtime details belong to `/status`; keeping this footprint small lets the
 * prompt take over the screen without a layout jump.
 */
export function headerHeight(width: number): number {
  const compact = headerWidth(width) < MIN_SPLIT_WIDTH;
  const cardContentRows = compact ? PNG_HEADER_ART_HEIGHT + 2 : PNG_HEADER_ART_HEIGHT;
  return HEADER_TOP_SPACE + 1 + HEADER_WORDMARK_GAP
    + HEADER_CARD_PADDING_Y * 2 + HEADER_BORDER_ROWS + cardContentRows
    + HEADER_BOTTOM_SPACE;
}

export interface HeaderProps {
  readonly width: number;
}

/**
 * PLIF's startup identity.
 *
 * Design brief:
 * - Who and what for: a developer arriving at the CLI, deciding what to do.
 * - Direction: quiet terminal technicalism with luxury restraint.
 * - One memorable thing: the wordmark floats above a compact mascot/status split.
 * - What it is not: a dashboard, status card, or permanent diagnostics panel.
 *
 * This component is deliberately still. Work-state motion belongs to the
 * working surface, not to the idle identity shown on every launch.
 */
export function Header({ width }: HeaderProps): React.ReactElement {
  const frameWidth = headerWidth(width);
  const compact = frameWidth < MIN_SPLIT_WIDTH;
  const contentWidth = Math.max(1, frameWidth - 4);
  const leftWidth = compact ? contentWidth : Math.max(18, Math.floor(contentWidth * 0.38));
  const rightWidth = Math.max(1, contentWidth - leftWidth - 1);

  return (
    <Box
      width="100%"
      justifyContent="center"
      alignItems="center"
      flexDirection="column"
      marginTop={HEADER_TOP_SPACE}
      marginBottom={HEADER_BOTTOM_SPACE}
    >
      <Box marginBottom={HEADER_WORDMARK_GAP}>
        <Text color={color('text')} bold>PLIF</Text>
      </Box>
      <Box
        width={frameWidth}
        borderStyle="round"
        borderColor={color('faint')}
        paddingX={1}
        paddingY={HEADER_CARD_PADDING_Y}
      >
        {compact ? (
          <Box flexDirection="column" alignItems="center" width={contentWidth}>
            <PngHeaderArt />
            <Text color={color('accentDim')}>Ready to work</Text>
            <Text color={color('ghost')}>/ for commands</Text>
          </Box>
        ) : (
          <Box width={contentWidth} height={PNG_HEADER_ART_HEIGHT}>
            <Box width={leftWidth} alignItems="center" justifyContent="center">
              <PngHeaderArt />
            </Box>
            <Text color={color('ghost')}>
              {'│\n'.repeat(PNG_HEADER_ART_HEIGHT - 1)}│
            </Text>
            <Box
              flexDirection="column"
              justifyContent="center"
              width={rightWidth}
              height={PNG_HEADER_ART_HEIGHT}
              paddingLeft={2}
            >
              <Text color={color('text')} bold>Ready to work</Text>
              <Text color={color('muted')} wrap="truncate">Describe a task, or / for commands</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
