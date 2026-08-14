import React from 'react';
import { Box, Text } from 'ink';

import type { Command } from '../commands.js';
import { color, glyph, layout, truncate } from '../theme.js';

interface CompletionsProps {
  readonly matches: readonly Command[];
  readonly selected: number;
  readonly width: number;
  readonly maxRows?: number;
}

/**
 * The command menu.
 *
 * Appears the moment the input starts with `/` and narrows as you type. This
 * replaces the "type /help, read a wall of text, retype your command" loop with
 * discovery in place — the developer learns the command surface by using it.
 *
 * It renders *above* the prompt rather than below, so the prompt stays welded
 * to the bottom of the frame. A menu that pushes the input line down means the
 * place you are typing moves while you type, which is genuinely disorienting.
 */
export function Completions({
  matches,
  selected,
  width,
  maxRows = 6,
}: CompletionsProps): React.ReactElement | null {
  if (matches.length === 0) return null;

  // Cap the list and slide a window over it, keeping the selection visible.
  const rows = Math.max(1, maxRows);
  const start = Math.max(0, Math.min(selected - rows + 2, matches.length - rows));
  const visible = matches.slice(start, start + rows);
  const nameWidth = Math.max(...matches.map((command) => command.name.length)) + 2;

  return (
    <Box flexDirection="column" paddingX={layout.gutter + 1} marginBottom={0}>
      {start > 0 && <Text color={color('ghost')}>  {glyph.pending} {start} above</Text>}

      {visible.map((command, index) => {
        const active = start + index === selected;
        return (
          <Box key={command.name}>
            <Text color={color(active ? 'accent' : 'ghost')}>
              {active ? glyph.caret : ' '}{' '}
            </Text>
            <Box width={nameWidth}>
              <Text color={color(active ? 'text' : 'faint')} bold={active}>
                /{command.name}
              </Text>
            </Box>
            <Text color={color(active ? 'muted' : 'ghost')}>
              {truncate(
                command.args ? `${command.args}  ${command.summary}` : command.summary,
                Math.max(10, width - nameWidth - 6),
              )}
            </Text>
          </Box>
        );
      })}

      {start + rows < matches.length && (
        <Text color={color('ghost')}>
          {'  '}
          {glyph.pending} {matches.length - start - rows} more
        </Text>
      )}
    </Box>
  );
}

/**
 * The emoji menu, opened by `:`.
 *
 * Same shape and same keys as the command menu, because it is the same
 * gesture: type a sigil, narrow with letters, Tab to take the highlighted one.
 * Learning it twice would be a tax for no reason.
 *
 * The glyph is shown next to every candidate rather than only on the selected
 * one — the name is a guess at what the picture is, and half the point of
 * choosing from a list is seeing the thing before you commit to it.
 */
export function EmojiMenu({
  matches,
  selected,
  width,
  maxRows = 6,
}: {
  matches: readonly { name: string; emoji: string }[];
  selected: number;
  width: number;
  maxRows?: number;
}): React.ReactElement | null {
  if (matches.length === 0) return null;

  const rows = Math.max(1, maxRows);
  const start = Math.max(0, Math.min(selected - rows + 2, matches.length - rows));
  const visible = matches.slice(start, start + rows);

  return (
    <Box flexDirection="column" paddingX={layout.gutter + 1}>
      {visible.map((match, index) => {
        const active = start + index === selected;
        return (
          <Box key={match.name}>
            <Text color={color(active ? 'accent' : 'ghost')}>
              {active ? glyph.caret : ' '}{' '}
            </Text>
            <Box width={4}>
              <Text>{match.emoji}</Text>
            </Box>
            <Text color={color(active ? 'text' : 'faint')} bold={active}>
              {truncate(`:${match.name}:`, Math.max(10, width - 10))}
            </Text>
          </Box>
        );
      })}
      {start + rows < matches.length && (
        <Text color={color('ghost')}>
          {'  '}
          {glyph.pending} {matches.length - start - rows} more
        </Text>
      )}
    </Box>
  );
}
