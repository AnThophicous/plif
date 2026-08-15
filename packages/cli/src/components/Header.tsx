import React from 'react';
import { Box, Text } from 'ink';

import { color, shortenPath, truncate } from '../theme.js';

/** The controlled-test ASCII supplied for the live Plif header. */
export const HEADER_INFINITY = [
  '  ▄▟▀▙▖',
  '▄▀▞█▙ ▀▙▖',
  '▀▀▘ ▝▜▖ ▀▙▖',
  '      ▜▖  ▀▜▄▄',
  '       ▌     ▀▀▀▀▀▜▄▖',
  '       ▜            ▜▖',
  '       ▝▙  ▗▛▀▀▜▖   ▌▌',
  '        ▝▙ ▛    ▝▜▖▐ ▌',
  '         ▝▖▌      ▞▐▀',
  '         ▟▙▌     ▗█▟',
].join('\n');
export const HEADER_INFINITY_COMPACT = '▄▀█▄';
const HEADER_INFINITY_WIDTH = Math.max(...HEADER_INFINITY.split('\n').map((line) => line.length));

/** Rows occupied by the live header, including its breathing margin. */
export function headerHeight(width: number): number {
  return width < 74 ? 8 : HEADER_INFINITY.split('\n').length + 9;
}

export interface HeaderProps {
  readonly cwd: string;
  readonly width: number;
  readonly model: string;
  readonly effort?: string;
  readonly version: string;
}

export function Header({
  cwd,
  width,
  model,
  effort,
  version,
}: HeaderProps): React.ReactElement {
  const narrow = width < 74;
  const modelLabel = model || 'model not configured';
  const workspace = truncate(
    shortenPath(cwd, Math.max(16, width - 20)),
    Math.max(1, width - 20),
  );

  if (narrow) {
    return (
      <Box
        flexDirection="column"
        width="100%"
        marginBottom={1}
        borderStyle="round"
        borderColor={color('faint')}
        paddingX={1}
        paddingY={1}
      >
        <Box justifyContent="space-between" width="100%">
          <Text color={color('text')} bold>{HEADER_INFINITY_COMPACT} PLIF Code</Text>
          <Text color={color('ghost')}>v{version}</Text>
        </Box>
        <Text color={color('muted')} wrap="truncate">workspace: {workspace}</Text>
        <Text color={color('ghost')} wrap="truncate">
          {truncate(modelLabel, Math.max(8, width - 10))} · /model
        </Text>
      </Box>
    );
  }

  // The compact mark is 22 cells wide. Give it its own measured column so
  // Ink never wraps the art into a different shape while laying out the header.
  const leftWidth = Math.max(22, Math.min(HEADER_INFINITY_WIDTH + 2, width - 18));
  const rightWidth = Math.max(10, width - leftWidth - 3);

  return (
    <Box borderStyle="round" borderColor={color('faint')} width="100%" marginBottom={1}>
      <Box flexDirection="column" width={leftWidth} paddingX={1} paddingY={1}>
        <Box flexDirection="column">
          <Text color={color('accentDim')} bold>{HEADER_INFINITY}</Text>
          <Text color={color('text')} bold>PLIF</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={color('ghost')}>v{version}</Text>
        </Box>
        <Text color={color('text')} bold>Code workspace</Text>
        <Text color={color('muted')} wrap="truncate">{workspace}</Text>
        <Text color={color('ghost')} wrap="truncate">
          {truncate(modelLabel, Math.max(8, leftWidth - 4))}{effort ? ` · ${effort}` : ''}
        </Text>
      </Box>
      <Text color={color('faint')}>
        {'│\n'.repeat(Math.max(0, HEADER_INFINITY.split('\n').length + 3))}│
      </Text>
      <Box
        flexDirection="column"
        width={rightWidth}
        paddingX={1}
        paddingY={1}
      >
        <Text color={color('accentDim')} bold>Ready to work</Text>
        <Text color={color('muted')}>Plan, work, review — then ship with evidence.</Text>
        <Text color={color('ghost')}>Type / for commands · Ctrl+T transcript · Ctrl+C stop</Text>
      </Box>
    </Box>
  );
}
