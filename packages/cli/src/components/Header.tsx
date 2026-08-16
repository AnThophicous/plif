import React from 'react';
import { Box, Text } from 'ink';

import { color, shortenPath, truncate } from '../theme.js';
import { PNG_HEADER_ART_HEIGHT, PNG_HEADER_ART_WIDTH, PngHeaderArt } from './PngHeaderArt.js';

/** Rows occupied by the live header, including its breathing margin. */
export function headerHeight(width: number): number {
  return width < 74 ? 8 : PNG_HEADER_ART_HEIGHT + 9;
}

/** Keep the identity panel intentional instead of stretching it across a wide terminal. */
export function headerPanelWidth(width: number): number {
  return width < 74 ? width : Math.min(width, 84);
}

export interface HeaderProps {
  readonly cwd: string;
  readonly width: number;
  readonly model: string;
  readonly effort?: string;
  readonly themeRevision?: number;
  readonly version: string;
}

export const Header = React.memo(function Header({
  cwd,
  width,
  model,
  effort,
  version,
}: HeaderProps): React.ReactElement {
  const narrow = width < 74;
  const panelWidth = headerPanelWidth(width);
  const modelLabel = model || 'model not configured';
  const modelStatus = effort ? `${modelLabel} · ${effort}` : modelLabel;
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
          <Text color={color('text')} bold>PLIF Code</Text>
          <Text color={color('ghost')}>v{version}</Text>
        </Box>
        <Text color={color('muted')} wrap="truncate">workspace: {workspace}</Text>
        <Text color={color('ghost')} wrap="truncate">
          {truncate(modelLabel, Math.max(8, width - 10))} · /model
        </Text>
      </Box>
    );
  }

  // The compact PNG raster has its own measured column so Ink never wraps the
  // art into a different shape while laying out the header. The panel itself
  // is deliberately bounded; a full-width border turns the identity into a
  // tiny island surrounded by empty chrome on wide terminals.
  const leftWidth = Math.max(28, Math.min(PNG_HEADER_ART_WIDTH + 14, panelWidth - 24));
  const rightWidth = Math.max(20, panelWidth - leftWidth - 3);
  const dividerRows = Math.max(1, headerHeight(width) - 2);

  return (
    <Box borderStyle="round" borderColor={color('faint')} width={panelWidth} marginBottom={1}>
      <Box flexDirection="column" width={leftWidth} paddingX={1} paddingY={1}>
        <Box flexDirection="column" alignItems="center">
          <PngHeaderArt />
          <Text color={color('text')} bold>PLIF</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={color('ghost')}>v{version}</Text>
        </Box>
        <Text color={color('text')} bold>Code workspace</Text>
        <Text color={color('muted')} wrap="truncate">{workspace}</Text>
        <Text color={color('ghost')} wrap="truncate">
          {truncate(modelStatus, Math.max(8, leftWidth - 4))}
        </Text>
      </Box>
      <Text color={color('faint')}>
        {'│\n'.repeat(Math.max(0, dividerRows - 1))}│
      </Text>
      <Box
        flexDirection="column"
        width={rightWidth}
        paddingX={1}
        paddingY={1}
      >
        <Text color={color('accentDim')} bold>Ready to work</Text>
        <Text color={color('muted')}>Plan, work, review — then ship with evidence.</Text>
        <Text color={color('ghost')}>Type / commands · Ctrl+T transcript · Ctrl+C stop</Text>
      </Box>
    </Box>
  );
});
