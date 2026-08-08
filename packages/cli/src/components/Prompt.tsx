import React from 'react';
import { Box, Text } from 'ink';

import { Spinner } from './Spinner.js';
import { clusterAt, snap } from '../text.js';
import { color, glyph, layout, truncate } from '../theme.js';

export interface PromptProps {
  readonly value: string;
  readonly cursor: number;
  readonly placeholder: string;
  readonly focused: boolean;
  readonly busy: boolean;
  readonly busyLabel: string;
  /** When busy, the timestamp work started, for the elapsed counter. */
  readonly busySince?: number;
  readonly width: number;
  /** Right-aligned label inside the box, e.g. the target container. */
  readonly badge?: string;
  /** Rendered inside the frame, under the field: the pending message queue. */
  readonly queue?: React.ReactNode;
}

/** Below this the badge is dropped; the container is already in the header. */
const DROP_BADGE_BELOW = 60;

/**
 * The input.
 *
 * A bordered box rather than a bare line, for one reason: it gives the eye a
 * fixed place to return to. In a log that is constantly appending, an unboxed
 * prompt drifts and the developer has to hunt for where their typing goes.
 *
 * The box stays grey in every state. Focus is signalled by *brightness* rather
 * than by hue — the accent colour is reserved for agent activity, and a
 * permanently accented input box would compete with the timeline for it while
 * saying nothing, since the prompt is always there.
 *
 * ## Everything on one line, always
 *
 * The content is windowed to the available width rather than wrapped. A wrapped
 * prompt is a bug in disguise: the box grows a second row, the right-aligned
 * badge lands in the middle of the placeholder, and the whole frame shifts
 * under the cursor while the user is typing. Long input scrolls horizontally
 * around the cursor instead, the way every other text field does.
 */
export function Prompt({
  value,
  cursor,
  placeholder,
  focused,
  busy,
  busyLabel,
  busySince,
  width,
  badge,
  queue,
}: PromptProps): React.ReactElement {
  const borderTone = focused ? 'faint' : 'ghost';

  // border(2) + horizontal padding(2) + the prompt glyph and its space(2).
  const chrome = 2 + layout.boxPadX * 2 + 2;
  const showBadge = badge !== undefined && width >= DROP_BADGE_BELOW;
  const badgeWidth = showBadge ? (badge as string).length + 2 : 0;
  const available = Math.max(8, width - chrome - badgeWidth);

  /*
    The field stays live while the agent works.

    It used to be replaced by "Esc to cancel", which quietly stated a policy:
    the only thing you may do during a turn is abort it. So remembering one more
    detail thirty seconds in meant killing work that was going fine. Now the
    field keeps taking input and Enter files it for the next tool call, and the
    placeholder is what says so.
  */
  const hint = busy ? 'type to queue a message for the agent' : placeholder;

  return (
    <Box flexDirection="column" width="100%">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color(borderTone)}
        paddingX={layout.boxPadX}
        width="100%"
      >
        <Box width="100%">
          <Box flexGrow={1}>
            <Text color={color(busy ? 'ghost' : 'muted')}>{glyph.prompt} </Text>
            {value.length === 0 ? (
              <Text color={color('ghost')} wrap="truncate">
                {truncate(hint, available)}
              </Text>
            ) : (
              <CursorText value={value} cursor={cursor} focused={focused} available={available} />
            )}
          </Box>
          {showBadge && (
            <Text color={color('ghost')} wrap="truncate">
              {badge}
            </Text>
          )}
        </Box>
        {/* Queued messages sit inside the same frame: they are part of what is
            about to be said, not part of what has happened. */}
        {queue}
      </Box>
    </Box>
  );
}

/**
 * Text with a block cursor, windowed so the cursor is always on screen.
 *
 * Ink cannot position a real terminal cursor inside its managed frame, so the
 * cursor has to be part of the rendered string; inverting the character under
 * it reads as a cursor at any terminal theme, where a coloured background block
 * would disappear on some.
 */
function CursorText({
  value,
  cursor,
  focused,
  available,
}: {
  value: string;
  cursor: number;
  focused: boolean;
  available: number;
}): React.ReactElement {
  const { text, offset, clippedLeft, clippedRight } = windowAround(value, cursor, available);

  if (!focused) {
    return (
      <Text color={color('text')} wrap="truncate">
        {text}
      </Text>
    );
  }

  // Snapped to a cluster boundary, and the highlighted cell is the whole
  // cluster. Taking one code unit put the inverse block over half a surrogate
  // pair and the terminal drew a replacement box.
  const index = snap(text, Math.max(0, Math.min(cursor - offset, text.length)));
  const at = clusterAt(text, index);
  const before = text.slice(0, index);
  const after = text.slice(index + (index < text.length ? at.length : 0));

  return (
    <Text wrap="truncate">
      {clippedLeft && <Text color={color('ghost')}>{glyph.clip}</Text>}
      <Text color={color('text')}>{before}</Text>
      <Text inverse>{at}</Text>
      <Text color={color('text')}>{after}</Text>
      {clippedRight && <Text color={color('ghost')}>{glyph.clip}</Text>}
    </Text>
  );
}

/**
 * Slide a window over the value so the cursor stays visible.
 *
 * Anchors to the end while typing (the common case) and only scrolls back when
 * the cursor moves left out of view — so the text does not jitter sideways on
 * every keystroke, which is what a naive centre-the-cursor window does.
 */
export function windowAround(
  value: string,
  cursor: number,
  available: number,
): { text: string; offset: number; clippedLeft: boolean; clippedRight: boolean } {
  if (value.length <= available) {
    return { text: value, offset: 0, clippedLeft: false, clippedRight: false };
  }

  // Reserve a cell for each clip marker that will actually be drawn.
  const room = Math.max(4, available - 1);
  let offset = Math.max(0, cursor - room + 1);
  // Never scroll past the end: leave the tail flush against the right edge.
  offset = Math.min(offset, Math.max(0, value.length - room));

  // Both edges snapped, so the window never begins or ends inside a character.
  const start = snap(value, offset);
  const end = snap(value, start + room);

  return {
    text: value.slice(start, end),
    offset: start,
    clippedLeft: start > 0,
    clippedRight: end < value.length,
  };
}
