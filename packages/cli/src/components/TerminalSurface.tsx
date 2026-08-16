import React from 'react';
import { Box, Text } from 'ink';

import { terminalFrameRows } from '../terminal-resize.js';
import { color, layout } from '../theme.js';

export function SurfaceFill({
  width,
  height,
  backgroundColor,
}: {
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
}): React.ReactElement {
  const fill = React.useMemo(() => {
    const line = ' '.repeat(Math.max(1, width));
    return Array.from({ length: Math.max(1, height) }, () => line).join('\n');
  }, [height, width]);

  return (
    <Box position="absolute" width={width} height={height}>
      <Text backgroundColor={backgroundColor}>{fill}</Text>
    </Box>
  );
}

export interface TerminalSurfaceLayout {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly panelPaddingX: number;
  readonly panelPaddingY: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export function terminalSurfaceLayout(
  columns: number,
  rows: number,
  reservedTopRows = 0,
): TerminalSurfaceLayout {
  const canvasWidth = Math.max(1, Math.floor(columns));
  const canvasHeight = terminalFrameRows(Math.max(1, Math.floor(rows)));
  const panelWidth = canvasWidth;
  const panelHeight = Math.max(1, canvasHeight - Math.max(0, Math.floor(reservedTopRows)));
  const panelPaddingX = Math.min(layout.surfacePadX, Math.max(0, Math.floor(panelWidth / 2)));
  const panelPaddingY = Math.min(layout.surfacePadY, Math.max(0, Math.floor(panelHeight / 2)));

  return {
    canvasWidth,
    canvasHeight,
    panelWidth,
    panelHeight,
    panelPaddingX,
    panelPaddingY,
    contentWidth: Math.max(1, panelWidth - panelPaddingX * 2),
    contentHeight: Math.max(1, panelHeight - panelPaddingY * 2),
  };
}

export function TerminalSurface({
  columns,
  rows,
  children,
}: {
  readonly columns: number;
  readonly rows: number;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const frame = terminalSurfaceLayout(columns, rows);

  return (
    <Box
      width={frame.canvasWidth}
      height={frame.canvasHeight}
      flexDirection="column"
    >
      <SurfaceFill
        width={frame.canvasWidth}
        height={frame.canvasHeight}
        backgroundColor={color('panel')}
      />
      <Box
        width={frame.panelWidth}
        height={frame.panelHeight}
        flexDirection="column"
        paddingX={frame.panelPaddingX}
        paddingY={frame.panelPaddingY}
      >
        {children}
      </Box>
    </Box>
  );
}
