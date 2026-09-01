import React from 'react';
import { Box, Text } from '../ui.js';

import type { ArgumentCompletion, Command } from '../commands.js';
import { displayWidth } from '../text.js';
import { color, glyph, layout, truncate } from '../theme.js';

/** The caret gutter, in cells: the mark plus the space after it. */
const CARET_WIDTH = 2;

interface CompletionsProps {
  readonly matches: readonly Command[];
  readonly argumentMatches?: readonly ArgumentCompletion[];
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
 *
 * The highlighted row is the one thing that changes when the user moves the
 * selection. The menu itself is static while open: keyboard navigation should
 * not subscribe the entire completion surface to an animation clock.
 */
export function Completions({
  matches,
  argumentMatches,
  selected,
  width,
  maxRows = 6,
}: CompletionsProps): React.ReactElement | null {
  const isArgumentMenu = argumentMatches !== undefined;
  const argumentRows = argumentMatches ?? [];
  if (matches.length === 0 && argumentRows.length === 0) return null;

  const caretTone = color('accentBright');

  // Cap the list and slide a window over it, keeping the selection visible.
  const rows = Math.max(1, maxRows);
  const sourceLength = isArgumentMenu ? argumentRows.length : matches.length;
  const start = Math.max(0, Math.min(selected - rows + 2, sourceLength - rows));
  const visibleCommands = matches.slice(start, start + rows);
  const visibleArguments = argumentRows.slice(start, start + rows);
  // Every column is a padded string rather than a flex box. A row whose parts
  // are allowed to size themselves re-flows the moment one summary is a
  // character too long: the menu then paints its names at three different
  // indents and spills the last word onto the next line. Fixed cells cannot.
  const rowWidth = Math.max(20, Math.floor(width));
  const nameWidth = Math.min(
    Math.max(8, Math.floor(rowWidth / 3)),
    isArgumentMenu
      ? Math.max(...argumentRows.map((match) => displayWidth(match.label))) + 2
      : Math.max(...matches.map((command) => displayWidth(`/${command.name}`))) + 2,
  );
  const argsWidth = isArgumentMenu ? 0 : Math.min(
    Math.max(0, Math.floor(rowWidth / 4)),
    Math.max(0, ...visibleCommands.map((command) => displayWidth(command.args ?? ''))) + 2,
  );
  const summaryWidth = Math.max(8, rowWidth - CARET_WIDTH - nameWidth - argsWidth);
  const cell = (value: string, cells: number): string => {
    const clipped = truncate(value, cells);
    return clipped + ' '.repeat(Math.max(0, cells - displayWidth(clipped)));
  };

  return (
    <Box flexDirection="column" paddingX={layout.gutter + 1} marginBottom={0}>
      {!isArgumentMenu && (
        <>
          <Text color={color('accent')} bold>Commands</Text>
          <Text>{' '}</Text>
        </>
      )}
      {start > 0 && <Text color={color('ghost')}>  {glyph.pending} {start} above</Text>}

      {isArgumentMenu
        ? visibleArguments.map((match, index) => {
          const active = start + index === selected;
          const nameTone = match.tone ?? (active ? 'text' : 'faint');
          return (
            <Box key={match.value} width={rowWidth}>
              <Text color={active ? caretTone : color('ghost')}>
                {cell(active ? glyph.caret : ' ', CARET_WIDTH)}
              </Text>
              <Text color={color(nameTone)} bold={active}>
                {cell(match.label, nameWidth)}
              </Text>
              <Text color={color(active ? 'muted' : 'ghost')}>
                {cell(match.detail ?? '', summaryWidth)}
              </Text>
            </Box>
          );
        })
        : visibleCommands.map((command, index) => {
        const active = start + index === selected;
        return (
          <Box key={command.name} width={rowWidth}>
            <Text color={active ? caretTone : color('ghost')}>
              {cell(active ? glyph.caret : ' ', CARET_WIDTH)}
            </Text>
            <Text color={color(active ? 'accentBright' : 'muted')} bold={active}>
              {cell(`/${command.name}`, nameWidth)}
            </Text>
            {argsWidth > 0 && (
              <Text color={color(active ? 'accentDim' : 'ghost')}>
                {/* One cell of the column is a gap, so a clipped argument
                    hint never runs straight into the summary text. */}
                {cell(truncate(command.args ?? '', argsWidth - 1), argsWidth)}
              </Text>
            )}
            <Text color={color(active ? 'muted' : 'ghost')}>
              {cell(command.summary, summaryWidth)}
            </Text>
          </Box>
        );
      })}

      {start + rows < sourceLength && (
        <Text color={color('ghost')}>
          {'  '}
          {glyph.pending} {sourceLength - start - rows} more
        </Text>
      )}
      <Text color={color('muted')}>
        {truncate(
          `  Tab:accept · ↑↓:choose · Enter:${isArgumentMenu ? 'accept' : 'run'} · Esc:dismiss`,
          Math.max(8, width),
        )}
      </Text>
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
  readonly selected: number;
  readonly width: number;
  readonly maxRows?: number;
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
      <Text color={color('muted')}>
        {truncate('  Tab:insert · ↑↓:choose · Esc:dismiss', Math.max(8, width))}
      </Text>
    </Box>
  );
}
