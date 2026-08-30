import React from 'react';
import { Box, Text } from '../ui.js';

import { displayWidth, clusterLength } from '../text.js';
import { color } from '../theme.js';
import { SurfaceFill } from './TerminalSurface.js';

export interface PastedTextDialogProps {
  readonly text: string;
  readonly width: number;
  readonly height: number;
}

export interface WrappedPastedText {
  readonly lines: readonly string[];
  readonly truncated: boolean;
}

/** Wrap clipboard content into the exact number of rows the modal can show. */
export function wrapPastedText(value: string, width: number, maxLines: number): WrappedPastedText {
  const available = Math.max(1, Math.floor(width));
  const limit = Math.max(1, Math.floor(maxLines));
  const lines: string[] = [];
  let truncated = false;

  const push = (line: string): boolean => {
    if (lines.length >= limit) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  };

  for (const source of value.replace(/\r\n?/g, '\n').split('\n')) {
    if (source.length === 0) {
      if (!push('')) break;
      continue;
    }

    let at = 0;
    while (at < source.length) {
      let end = at;
      let cells = 0;
      let lastSpace = -1;
      while (end < source.length) {
        const length = clusterLength(source, end) || 1;
        const next = source.slice(end, end + length);
        const nextCells = displayWidth(next);
        if (cells > 0 && cells + nextCells > available) break;
        cells += nextCells;
        end += length;
        if (next === ' ') lastSpace = end;
      }
      if (end === at) end += clusterLength(source, at) || 1;
      const breakAt = end < source.length && lastSpace > at ? lastSpace : end;
      if (!push(source.slice(at, breakAt).replace(/ +$/g, ''))) break;
      at = breakAt;
      while (source[at] === ' ') at += 1;
    }
    if (truncated) break;
  }

  if (lines.length === 0) lines.push('');
  return { lines, truncated };
}

/**
 * Full-screen terminal modal. The old frame is covered by the panel surface,
 * rather than being squeezed into a card; this is the same focus model as the
 * Plugins view and keeps the pasted content readable at narrow widths.
 */
export const PastedTextDialog = React.memo(function PastedTextDialog({
  text,
  width,
  height,
}: PastedTextDialogProps): React.ReactElement {
  const frameWidth = Math.max(1, Math.floor(width));
  const frameHeight = Math.max(8, Math.floor(height));
  // Reserve the modal border, its two-cell inner padding and the terminal's
  // left/right frame padding. The extra couple of cells keep Ink from wrapping
  // a line a second time and splitting a word at the edge of a narrow TTY.
  const bodyWidth = Math.max(8, frameWidth - 16);
  const bodyHeight = Math.max(2, frameHeight - 10);
  const wrapped = wrapPastedText(text, bodyWidth, bodyHeight);
  const lineCount = text.length === 0 ? 0 : text.replace(/\r\n?/g, '\n').split('\n').length;

  return (
    <Box
      position="absolute"
      // Ink's width is the content width; the modal's two-cell side padding is
      // therefore subtracted here so the painted surface remains exactly inside
      // the terminal instead of producing a 2-cell overflow on every frame.
      width={Math.max(1, frameWidth - 4)}
      height={frameHeight}
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      overflowY="hidden"
    >
      <SurfaceFill width={Math.max(1, frameWidth - 2)} height={frameHeight} backgroundColor={color('panel')} />
      <Box width="100%" justifyContent="space-between" flexShrink={0}>
        <Text color={color('accentBright')} bold>Texto colado</Text>
        <Text color={color('muted')}>esc</Text>
      </Box>
      <Text color={color('accentDim')}>
        Clipboard preview · {lineCount} {lineCount === 1 ? 'linha' : 'linhas'}
      </Text>
      <Box
        width="100%"
        height={bodyHeight + 4}
        marginTop={1}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        borderStyle="round"
        borderColor={color('accentBorder')}
        overflowY="hidden"
      >
        <Text color={color('accentBright')} bold>Texto colado:</Text>
        <Box flexDirection="column" marginTop={1} overflowY="hidden">
          {wrapped.lines.map((line, index) => (
            <Text key={`${index}:${line}`} color={color('text')}>{line.length > 0 ? line : ' '}</Text>
          ))}
          {wrapped.truncated && <Text color={color('muted')}>… texto continua</Text>}
        </Box>
      </Box>
      <Box marginTop={1} flexShrink={0}>
        <Text color={color('muted')}>Esc fechar</Text>
      </Box>
    </Box>
  );
});

PastedTextDialog.displayName = 'PastedTextDialog';
