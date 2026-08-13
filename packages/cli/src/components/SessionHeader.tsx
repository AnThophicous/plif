import React from 'react';
import { Box, Text } from 'ink';

import { color, glyph, shortenPath, truncate } from '../theme.js';

export interface SessionHeaderProps {
  readonly version: string;
  readonly cwd: string;
  readonly model: string | null;
  readonly provider: string | null;
  readonly sandboxGaps: readonly string[];
  readonly width: number;
}

function wrapped(text: string, width: number): readonly string[] {
  const columns = Math.max(8, width);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + word.length + 1 <= columns) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/** Compact opening cell, printed once into scrollback rather than pinned on top. */
export function SessionHeader({
  version,
  cwd,
  model,
  provider,
  sandboxGaps,
  width,
}: SessionHeaderProps): React.ReactElement {
  const columns = Math.max(12, width);
  const identity = [provider, model].filter(Boolean).join(' / ');
  const title = identity
    ? `Plif ${version}  ${glyph.divider}  ${identity}`
    : `Plif ${version}`;

  return (
    <Box flexDirection="column" width={columns} marginBottom={1}>
      <Text color={color('text')} bold>{truncate(title, columns)}</Text>
      <Text color={color('muted')}>{truncate(shortenPath(cwd, columns - 2), columns)}</Text>
      {sandboxGaps.length === 0 ? (
        <Text color={color('success')}>{glyph.done} sandbox enforced</Text>
      ) : sandboxGaps.flatMap((gap, gapIndex) =>
        wrapped(gap, columns - 2).map((line, lineIndex) => (
          <Text key={`${gapIndex}:${lineIndex}`} color={color('warn')}>
            {lineIndex === 0 ? '! ' : '  '}{line}
          </Text>
        )),
      )}
    </Box>
  );
}
