import React from 'react';
import { Box, Text } from '../ui.js';

import type { PendingQuestion } from '../session.js';
import { color, formatDuration, glyph, truncate } from '../theme.js';

interface QuestionProps {
  readonly question: PendingQuestion;
  readonly selected: number;
  readonly draft: string;
  readonly queued: number;
  readonly width: number;
  readonly expanded: boolean;
  readonly compact?: boolean;
  readonly now: number;
}

const CONTEXT_PREVIEW = 3;
const CONTEXT_EXPANDED = 12;

function contextLinesFor(question: PendingQuestion): readonly string[] {
  return question.context?.trimEnd().split('\n') ?? [];
}

function contextRows(question: PendingQuestion, expanded: boolean): number {
  const lines = contextLinesFor(question);
  if (lines.length === 0) return 0;
  const budget = expanded ? CONTEXT_EXPANDED : CONTEXT_PREVIEW;
  return Math.min(lines.length, budget) + (lines.length > budget ? 1 : 0);
}

function optionRows(question: PendingQuestion): number {
  return (question.options ?? []).reduce(
    (total, option) => total + 1 + (option.description ? 1 : 0),
    0,
  );
}

/**
 * Exact row budget for the text chooser.
 *
 * The renderer below deliberately uses only one row per visible line. Keeping
 * the same arithmetic here prevents Ink from being handed a frame that is a
 * few rows taller than the layout budget on narrow terminals.
 */
export function questionHeight(
  question: PendingQuestion,
  compact: boolean,
  expanded: boolean,
): number {
  const options = question.options ?? [];
  const gap = compact ? 0 : 1;
  const context = contextRows(question, expanded);

  return 1 // status line
    + gap // status -> question
    + 1 // question
    + (options.length > 0
      ? gap + optionRows(question) + gap + 2 // options + divider + Other
      : 1) // free-text row when there are no options
    + (context > 0 ? gap + context : 0)
    + gap + 1 // keyboard hint
    + gap; // outer margin
}

/**
 * Resolve a terminal row to the option it represents.
 *
 * The app uses this for mouse clicks. Returning -1 selects the free-text row;
 * null means that the click was on the heading, context, or keyboard hint.
 */
export function questionChoiceAtRow(
  question: PendingQuestion,
  row: number,
  compact: boolean,
  expanded: boolean,
): number | null {
  if (!Number.isSafeInteger(row) || row < 0) return null;

  const options = question.options ?? [];
  const gap = compact ? 0 : 1;
  let cursor = 0;

  cursor += 1; // status line
  cursor += gap;
  cursor += 1; // question

  if (options.length > 0) {
    cursor += gap;
    for (let index = 0; index < options.length; index += 1) {
      const lines = 1 + (options[index]?.description ? 1 : 0);
      if (row >= cursor && row < cursor + lines) return index;
      cursor += lines;
    }
    cursor += gap;
    if (row === cursor || row === cursor + 1) return -1; // divider / Other
    cursor += 2;
  } else {
    if (row === cursor) return -1;
    cursor += 1;
  }

  const context = contextRows(question, expanded);
  if (context > 0) cursor += gap + context;
  return null;
}

function divider(width: number): string {
  return '─'.repeat(Math.max(1, width));
}

function ChoiceRow({
  number,
  label,
  description,
  active,
  width,
}: {
  readonly number: number;
  readonly label: string;
  readonly description?: string;
  readonly active: boolean;
  readonly width: number;
}): React.ReactElement {
  const marker = active ? glyph.caret : ' ';
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color(active ? 'accentBright' : 'ghost')}>{marker} </Text>
        <Text color={color(active ? 'accentBright' : 'text')} bold={active}>
          {number}. {truncate(label, Math.max(8, width - 4))}
        </Text>
      </Box>
      {description ? (
        <Text color={color(active ? 'muted' : 'faint')}>
          {'   '}{truncate(description, Math.max(8, width - 4))}
        </Text>
      ) : null}
    </Box>
  );
}

/** Keyboard-first question chooser, kept textual and intentionally unboxed. */
export function Question({
  question,
  selected,
  draft,
  queued,
  width,
  expanded,
  compact = false,
  now,
}: QuestionProps): React.ReactElement {
  // Selection is the only active visual state. The chooser has no spinner and
  // no per-row card, so waiting for a slow provider does not animate the page.
  const highlight = color('accentBright');
  const options = question.options ?? [];
  const typing = selected < 0;
  const total = queued + 1;
  const inner = Math.max(24, width - 2);
  const contextLines = contextLinesFor(question);
  const contextBudget = expanded ? CONTEXT_EXPANDED : CONTEXT_PREVIEW;
  const hidden = Math.max(0, contextLines.length - contextBudget);
  const gap = compact ? 0 : 1;
  const otherNumber = options.length + 1;
  const maskedDraft = question.secret
    ? '•'.repeat(Math.min(draft.length, Math.max(1, inner - 12)))
    : truncate(draft, Math.max(8, inner - 8));

  return (
    <Box flexDirection="column" width="100%" marginBottom={gap}>
      <Box justifyContent="space-between">
        <Text bold>
          <Text color={highlight}>{glyph.waiting}</Text>
          <Text color={color('accent')}>
            {' '}{question.secret ? 'Credential required' : 'Waiting for your answer'}
          </Text>
        </Text>
        <Text color={color('ghost')}>
          {total > 1 ? `+${total - 1} queued · ` : ''}{formatDuration(now - question.askedAt)}
        </Text>
      </Box>

      <Box flexDirection="column" width="100%" marginTop={gap}>
        <Text color={color('text')} bold>
          {truncate(question.text, inner)}
        </Text>

        {options.length > 0 ? (
          <Box flexDirection="column" marginTop={gap}>
            {options.map((option, index) => (
              <ChoiceRow
                key={`${option.value}:${index}`}
                number={index + 1}
                label={option.label}
                {...(option.description ? { description: option.description } : {})}
                active={selected === index}
                width={inner}
              />
            ))}
            <Box flexDirection="column" marginTop={gap}>
              <Text color={color('faint')}>{divider(inner)}</Text>
              <ChoiceRow
                number={otherNumber}
                label={maskedDraft || (question.secret ? 'Paste API key' : 'Type something')}
                active={typing}
                width={inner}
              />
            </Box>
          </Box>
        ) : (
          <ChoiceRow
            number={otherNumber}
            label={maskedDraft || (question.secret ? 'Paste API key' : 'Type something')}
            active={typing}
            width={inner}
          />
        )}

        {contextLines.length > 0 ? (
          <Box flexDirection="column" marginTop={gap}>
            {contextLines.slice(0, contextBudget).map((line, index) => (
              <Text key={index} color={color('ghost')}>
                {glyph.rail} {truncate(line, inner - 2)}
              </Text>
            ))}
            {hidden > 0 ? (
              <Text color={color('ghost')}>
                {'  '}… {hidden} more · Ctrl+E details
              </Text>
            ) : null}
          </Box>
        ) : null}

        <Box marginTop={gap}>
          <Text color={color('muted')}>
            {truncate(
              `Enter to select · ↑/↓ to navigate${question.context ? ' · Ctrl+E details' : ''} · Esc to cancel`,
              inner,
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
