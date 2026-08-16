import React from 'react';
import { Box, Text } from 'ink';

import { effortSymbol, effortVisual } from '../effort-visuals.js';
import { color, shortenPath, truncate } from '../theme.js';
import { PNG_HEADER_ART_HEIGHT, PNG_HEADER_ART_WIDTH, PngHeaderArt } from './PngHeaderArt.js';

export const HEADER_MAX_WIDTH = 84;

/** Width of the centered header card within the available terminal cells. */
export function headerWidth(width: number): number {
  return Math.min(HEADER_MAX_WIDTH, Math.max(1, Math.floor(width)));
}

/** Rows occupied by the live header, including its breathing margin. */
export function headerHeight(width: number): number {
  return headerWidth(width) < 74 ? 8 : PNG_HEADER_ART_HEIGHT + 10;
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
  const frameWidth = headerWidth(width);
  const narrow = frameWidth < 74;
  const modelLabel = model || 'model not configured';
  const effortLabel = effort ? `${effortSymbol(effort)} ${effortVisual(effort).label}` : '';
  const workspace = truncate(
    shortenPath(cwd, Math.max(16, frameWidth - 20)),
    Math.max(1, frameWidth - 20),
  );

  if (narrow) {
    return (
      <Box width="100%" justifyContent="center" marginBottom={1}>
        <Box
          flexDirection="column"
          width={frameWidth}
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
            {truncate(`${modelLabel}${effortLabel ? ` · ${effortLabel}` : ''}`, Math.max(8, frameWidth - 10))} · /model
          </Text>
        </Box>
      </Box>
    );
  }

  // The PNG raster has its own measured column so
  // Ink never wraps the art into a different shape while laying out the header.
  const leftWidth = Math.max(
    PNG_HEADER_ART_WIDTH + 8,
    Math.min(PNG_HEADER_ART_WIDTH + 12, frameWidth - 18),
  );
  const rightWidth = Math.max(10, frameWidth - leftWidth - 3);

  return (
    <Box width="100%" justifyContent="center" marginBottom={1}>
      <Box borderStyle="round" borderColor={color('faint')} width={frameWidth}>
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
            {truncate(modelLabel, Math.max(8, leftWidth - 4))}
          </Text>
          {effortLabel && (
            <Text color={color('accent')} bold wrap="truncate">
              {truncate(effortLabel, Math.max(8, leftWidth - 4))}
            </Text>
          )}
        </Box>
        <Text color={color('faint')}>
          {'│\n'.repeat(Math.max(0, PNG_HEADER_ART_HEIGHT + 3))}│
        </Text>
        <Box
          flexDirection="column"
          width={rightWidth}
          paddingX={1}
          paddingY={1}
        >
          <Text color={color('accentDim')} bold>Ready to work</Text>
          <Text color={color('muted')}>Plan, work, review — then ship with evidence.</Text>
          <Text color={color('ghost')}>Type / commands · Ctrl+T log · Ctrl+C stop</Text>
        </Box>
      </Box>
    </Box>
  );
}
