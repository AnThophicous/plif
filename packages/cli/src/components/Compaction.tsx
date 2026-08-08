import React from 'react';
import { Box, Text } from 'ink';

import type { CompactionState } from '../session.js';
import { color, formatCount, formatDuration, glyph } from '../theme.js';

interface CompactionProps {
  readonly state: CompactionState;
  readonly width: number;
  /** Redrawn on a timer so the elapsed counter moves. */
  readonly now: number;
}

/** Height in terminal lines, for the caller's layout budget. */
export const COMPACTION_HEIGHT = 2;

/**
 * A compaction pass, while it runs.
 *
 * Compaction is the one thing the loop does that can take minutes without
 * producing a single token — the last stage is a whole model call over the
 * transcript — so it is also the one thing most likely to be mistaken for a
 * hang. The bar is driven by the stage ladder rather than by elapsed time,
 * which means it is a real measure of progress: at 3/4 the mechanical passes
 * are done and only the summary is left.
 *
 * The token counts are the point of the whole operation, so they are on the
 * line: the developer can see the conversation is 140k and heading for 84k.
 */
export function Compaction({ state, width, now }: CompactionProps): React.ReactElement {
  const fraction = Math.max(0, Math.min(1, state.step / state.steps));
  const track = Math.max(10, Math.min(40, width - 34));
  const filled = Math.round(track * fraction);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color('accent')}>{glyph.step} </Text>
        <Text color={color('accent')}>Compacting conversation…</Text>
        <Text color={color('ghost')}> ({formatDuration(now - state.since)})</Text>
      </Box>
      <Box>
        <Text color={color('ghost')}>{'  ' + glyph.branch + ' '}</Text>
        <Text color={color('brand')}>{glyph.meterFull.repeat(filled)}</Text>
        <Text color={color('ghost')}>{glyph.meterEmpty.repeat(track - filled)}</Text>
        <Text color={color('muted')}>
          {' '}
          {Math.round(fraction * 100)}% {glyph.divider} {state.stage}
        </Text>
        <Text color={color('faint')}>
          {' '}
          {glyph.divider} {formatCount(state.before)} {glyph.caret} {formatCount(state.target)}
        </Text>
      </Box>
    </Box>
  );
}
