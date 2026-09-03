import React from 'react';
import { Box, Text } from '../ui.js';

import { TranscriptCells, measureTranscriptCell, measureTranscriptCells } from './Timeline.js';
import { visibleTranscriptSlice } from '../transcript/scroll.js';
import type { TranscriptViewport } from '../transcript/scroll.js';
import type { TranscriptCell } from '../transcript/types.js';
import { color, glyph } from '../theme.js';

export interface TranscriptOverlayProps {
  readonly cells: readonly TranscriptCell[];
  readonly active: TranscriptCell | null;
  readonly viewport: TranscriptViewport;
  readonly width: number;
  readonly height: number;
}

/** Full-screen, application-owned history navigation; normal mode keeps native scrollback. */
export function TranscriptOverlay({
  cells,
  active,
  viewport,
  width,
  height,
}: TranscriptOverlayProps): React.ReactElement {
  const all = active && !cells.some((cell) => cell.id === active.id)
    ? [...cells, active]
    : cells;
  const bodyHeight = Math.max(1, height - 2);
  const contentLines = measureTranscriptCells(all, width, true);
  const visible = visibleTranscriptSlice(
    all,
    viewport,
    bodyHeight,
    (cell) => measureTranscriptCell(cell, width, true),
  );
  const end = Math.max(0, contentLines - bodyHeight);
  const position = end === 0 ? 100 : Math.round((viewport.offset / end) * 100);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box width="100%" justifyContent="space-between">
        <Text color={color('text')} bold>{glyph.caret} Transcript</Text>
        <Text color={color(viewport.follow ? 'accent' : 'faint')}>
          {viewport.follow ? 'live' : `${position}%`}
        </Text>
      </Box>

      <Box flexDirection="column" height={bodyHeight} overflow="hidden">
        {visible.length > 0 ? (
          <TranscriptCells cells={visible} width={width} expanded />
        ) : (
          <Text color={color('ghost')}>No conversation yet.</Text>
        )}
      </Box>

      <Box width="100%" justifyContent="space-between">
        <Text color={color('ghost')}>↑↓ scroll  PgUp/PgDn page  Ctrl+A home</Text>
        {!viewport.follow ? (
          <Text color={color('accent')} inverse>
            {' '}Jump to bottom (Ctrl+End) ↓{' '}
          </Text>
        ) : (
          <Text color={color('ghost')}>Ctrl+T or Esc close</Text>
        )}
      </Box>
    </Box>
  );
}
