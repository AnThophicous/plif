import React from 'react';
import { Box, Text } from 'ink';

import { Diff } from './Diff.js';
import { useSpinnerFrame } from './Spinner.js';
import { color, glyph, truncate } from '../theme.js';

export interface ToolCallProps {
  readonly name: string;
  readonly target?: string;
  readonly summary?: string;
  readonly output?: string;
  /**
   * A unified diff, when this call changed a file.
   *
   * It replaces the output block rather than sitting beside it. The output for
   * an edit is one sentence saying what the diff shows, and printing both is
   * saying it twice.
   */
  readonly diff?: string;
  readonly expand?: boolean;
  readonly ok: boolean;
  readonly running: boolean;
  readonly width: number;
  readonly maxOutputLines?: number;
}

// Tool rows are a status feed, not a second terminal. Keeping the default
// compact prevents routine commands from consuming the conversation window.
const DEFAULT_OUTPUT_LINES = 3;
const ERROR_OUTPUT_LINES = 5;

export function ToolCall({
  name,
  target,
  summary,
  output,
  diff,
  expand = false,
  ok,
  running,
  width,
  maxOutputLines,
}: ToolCallProps): React.ReactElement {
  // Called unconditionally; hooks cannot be conditional. The interval is idle
  // unless the row is running, so a finished timeline costs no timers.
  const spinner = useSpinnerFrame(80, running);

  const headTone = running ? 'accentDim' : ok ? 'muted' : 'warn';
  const bulletTone = running ? 'accentDim' : ok ? 'ghost' : 'warn';
  // A still bullet on a row that is still working reads as finished, which is
  // the whole ambiguity: duration present, output absent, nothing moving.
  const bullet = running ? spinner : glyph.tool;

  const limit = maxOutputLines ?? (ok ? DEFAULT_OUTPUT_LINES : ERROR_OUTPUT_LINES);
  const lines = (output ?? '').replace(/\s+$/, '').split('\n').filter((line) => line.length > 0);
  const shown = lines.slice(0, limit);
  const hidden = lines.length - shown.length;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color(bulletTone)}>{bullet} </Text>
        <Text color={color(headTone)} bold={!running}>
          {name}
        </Text>
        {target !== undefined && (
          <>
            <Text color={color('ghost')}>(</Text>
            <Text color={color(ok ? 'faint' : 'warn')}>
              {truncate(target, Math.max(12, width - name.length - 8))}
            </Text>
            <Text color={color('ghost')}>)</Text>
          </>
        )}
      </Box>

      {summary && (
        <Box>
          <Text color={color('ghost')}>{`  ${glyph.branch} `}</Text>
          <Text color={color(ok ? 'faint' : 'warn')}>
            {truncate(summary, Math.max(12, width - 6))}
          </Text>
        </Box>
      )}

      {diff ? (
        <Diff diff={diff} width={width - 4} expand={expand} {...(target ? { path: target } : {})} />
      ) : shown.length > 0 && (
        <Box flexDirection="column">
          {shown.map((line, index) => (
            <Box key={index}>
              <Text color={color('ghost')}>{'    '}</Text>
              <Text color={color(ok ? 'faint' : 'warn')}>
                {truncate(line, Math.max(12, width - 6))}
              </Text>
            </Box>
          ))}
          {hidden > 0 && (
            <Text color={color('ghost')}>
              {'    '}… {hidden} more lines
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

export function summariseOutput(output: string, exitCode: number | null): string | undefined {
  const lines = output.replace(/\s+$/, '').split('\n').filter((line) => line.length > 0);

  if (exitCode !== null && exitCode !== 0) {
    return `exit ${exitCode} · ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`;
  }
  if (lines.length === 0) return 'no output';
  return `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`;
}
