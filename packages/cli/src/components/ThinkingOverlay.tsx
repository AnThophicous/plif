import React from 'react';
import { Box, Text } from '../ui.js';

import { blockAtLine } from '../thinking-history.js';
import type { ThinkingDocument } from '../thinking-history.js';
import type { TranscriptViewport } from '../transcript/scroll.js';
import { color, glyph, truncate } from '../theme.js';

export interface ThinkingOverlayProps {
  readonly document: ThinkingDocument;
  readonly viewport: TranscriptViewport;
  readonly width: number;
  readonly height: number;
}

export function thinkingBodyHeight(height: number): number {
  return Math.max(1, height - 2);
}

export function ThinkingOverlay({
  document,
  viewport,
  width,
  height,
}: ThinkingOverlayProps): React.ReactElement {
  const bodyHeight = thinkingBodyHeight(height);
  const visible = document.lines.slice(viewport.offset, viewport.offset + bodyHeight);
  const end = Math.max(0, document.lines.length - bodyHeight);
  const below = Math.max(0, document.lines.length - (viewport.offset + bodyHeight));
  const position = end === 0 ? 100 : Math.round((viewport.offset / end) * 100);
  const current = blockAtLine(document, viewport.offset);
  const live = document.blocks.some((block) => block.live);
  const title = document.blocks.length === 0
    ? 'Thinking'
    : `Thinking  ${current + 1}/${document.blocks.length}`;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box width="100%" justifyContent="space-between">
        <Text color={color('text')} bold>{glyph.caret} {title}</Text>
        <Text color={color(viewport.follow ? 'accent' : 'faint')}>
          {viewport.follow ? (live ? 'live' : 'newest') : `pinned ${position}%`}
        </Text>
      </Box>

      <Box flexDirection="column" height={bodyHeight} overflow="hidden">
        {document.lines.length === 0 ? (
          <Text color={color('ghost')}>Nothing has been thought yet.</Text>
        ) : (
          visible.map((line, index) => (
            <Box key={`${viewport.offset + index}`}>
              {line.kind === 'heading' ? (
                <>
                  <Text color={color('accentDim')}>{glyph.step} </Text>
                  <Text color={color('muted')} bold>{truncate(line.text, Math.max(8, width - 4))}</Text>
                </>
              ) : line.kind === 'blank' ? (
                <Text> </Text>
              ) : (
                <>
                  <Text color={color('ghost')}>{`  ${glyph.rail} `}</Text>
                  <Text color={color('faint')} italic>{truncate(line.text, Math.max(8, width - 6))}</Text>
                </>
              )}
            </Box>
          ))
        )}
      </Box>

      <Box width="100%" justifyContent="space-between">
        <Text color={color('ghost')}>
          {'↑↓ scroll  PgUp/PgDn page  ←→ thought  Ctrl+A top  Esc close'}
        </Text>
        {viewport.follow ? (
          <Text color={color('ghost')}>Ctrl+R close</Text>
        ) : (
          <Text color={color('accent')} inverse>
            {below > 0 ? ` ${below} lines below — Ctrl+End follows ` : ' Ctrl+End follows '}
          </Text>
        )}
      </Box>
    </Box>
  );
}
