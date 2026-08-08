import React from 'react';
import { Box, Text } from 'ink';

import type { QueuedMessage } from '../session.js';
import { color, glyph, truncate } from '../theme.js';

interface QueueProps {
  readonly messages: readonly QueuedMessage[];
  /** Which one Ctrl+X is aimed at. */
  readonly selected: number;
  readonly width: number;
}

/** Height in terminal lines, for the caller's layout budget. */
export function queueHeight(messages: readonly QueuedMessage[]): number {
  return messages.length === 0 ? 0 : Math.min(messages.length, MAX_ROWS) + 1;
}

const MAX_ROWS = 4;

/**
 * Messages waiting to be handed to the agent.
 *
 * They live inside the prompt's own frame rather than in the timeline, because
 * they have not happened yet. A queued line in the log would read as something
 * the agent was told, and the developer would spend the next minute wondering
 * why it was ignored.
 *
 * The `[x]` is deliberately quiet. It is not an action anyone should be drawn
 * to — the normal path is that a queued message gets sent, and the only reason
 * this exists is the occasional "that was meant for someone else". So it sits
 * in the corner in the dimmest colour available, and only the one the keys are
 * pointing at is lit at all.
 */
export function Queue({ messages, selected, width }: QueueProps): React.ReactElement | null {
  if (messages.length === 0) return null;

  const hidden = Math.max(0, messages.length - MAX_ROWS);
  const visible = messages.slice(0, MAX_ROWS);
  const index = Math.min(Math.max(0, selected), messages.length - 1);

  return (
    <Box flexDirection="column" width="100%">
      {visible.map((message, position) => {
        const active = position === index;
        return (
          <Box key={message.id} justifyContent="space-between" width="100%">
            <Box>
              <Text color={color('ghost')}>{glyph.pending} </Text>
              <Text color={color('faint')}>
                {truncate(message.text, Math.max(12, width - 10))}
              </Text>
              {message.images.length > 0 && (
                <Text color={color('ghost')}> +{message.images.length} image</Text>
              )}
            </Box>
            <Text color={color(active ? 'faint' : 'ghost')}>[x]</Text>
          </Box>
        );
      })}
      {hidden > 0 && (
        <Text color={color('ghost')}>
          {'  '}
          {hidden} more queued
        </Text>
      )}
    </Box>
  );
}
