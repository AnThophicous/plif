import React from 'react';
import { Box, Text } from '../ui.js';

import { color } from '../theme.js';

export const HEADER_MAX_WIDTH = 56;
const HEADER_TOP_SPACE = 1;
const HEADER_WORDMARK_GAP = 1;
const HEADER_BOTTOM_SPACE = 1;
const HEADER_CARD_PADDING_Y = 1;
const HEADER_BORDER_ROWS = 2;
const HEADER_CONTENT_ROWS = 2;

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
  return HEADER_TOP_SPACE + 1 + HEADER_WORDMARK_GAP
    + HEADER_CARD_PADDING_Y * 2 + HEADER_BORDER_ROWS + HEADER_CONTENT_ROWS
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
 * - One memorable thing: a small centered wordmark held by a quiet outline.
 * - What it is not: a dashboard, status card, or permanent diagnostics panel.
 *
 * This component is deliberately still. Work-state motion belongs to the
 * working surface, not to the idle identity shown on every launch.
 */
export function Header({ width }: HeaderProps): React.ReactElement {
  const frameWidth = headerWidth(width);
  const contentWidth = Math.max(1, frameWidth - 4);

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
        <Box
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          width={contentWidth}
          height={HEADER_CONTENT_ROWS}
        >
          <Text color={color('text')} bold>Ready to work</Text>
          <Text color={color('muted')} wrap="truncate">Describe a task, or / for commands</Text>
        </Box>
      </Box>
    </Box>
  );
}
