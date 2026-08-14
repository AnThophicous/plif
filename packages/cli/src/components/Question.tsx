import React from 'react';
import { Box, Text } from 'ink';

import type { PendingQuestion } from '../session.js';
import { breathingTone, useHighlightClock } from '../pulse.js';
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
const BREATH_FRAME_MS = 80;

export function questionHeight(
  question: PendingQuestion,
  compact: boolean,
  expanded: boolean,
): number {
  const options = question.options?.length ?? 0;
  const context = question.context
    ? Math.min(question.context.split('\n').length, expanded ? CONTEXT_EXPANDED : CONTEXT_PREVIEW) + 1
    : 0;
  return 4 + options * 2 + 2 + context + (compact ? 0 : 1);
}

/** Keyboard-first question picker. It intentionally mirrors a command palette. */
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
  const clock = useHighlightClock(true, BREATH_FRAME_MS);
  const highlight = breathingTone(clock, 'brand', 'accent');
  const options = question.options ?? [];
  const typing = selected < 0;
  const total = queued + 1;
  const inner = Math.max(24, width - 6);
  const contextLines = question.context?.trimEnd().split('\n') ?? [];
  const contextBudget = expanded ? CONTEXT_EXPANDED : CONTEXT_PREVIEW;
  const hidden = Math.max(0, contextLines.length - contextBudget);

  return (
    <Box flexDirection="column" width="100%" marginBottom={compact ? 0 : 1}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold>
          <Text color={highlight}>{glyph.waiting}</Text>
          <Text color={color('accent')}>
            {' '}{question.secret ? 'Credential required' : `Waiting on answers for ${total} ${total === 1 ? 'question' : 'questions'}`}
          </Text>
        </Text>
        <Text color={color('ghost')}>
          [turn: {formatDuration(now - question.askedAt)}] [x]
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={highlight}
        width="100%"
        paddingY={compact ? 0 : 1}
      >
        <Box paddingX={1} marginBottom={compact ? 0 : 1}>
          <Text color={color('text')} bold>{truncate(question.text, inner)}</Text>
        </Box>

        {options.map((option, index) => {
          const active = selected === index;
          return (
            <Box
              key={`${option.value}:${index}`}
              flexDirection="column"
              paddingX={1}
            >
              <Text color={color(active ? 'text' : 'muted')} bold={active} backgroundColor={active ? '#29292d' : undefined}>
                {index + 1}   <Text color={color(active ? 'accent' : 'ghost')}>○</Text> {truncate(option.label, inner - 7)}
              </Text>
              {option.description ? (
                <Text color={color('ghost')} backgroundColor={active ? '#29292d' : undefined}>    {truncate(option.description, inner - 4)}</Text>
              ) : null}
            </Box>
          );
        })}

        <Box
          flexDirection="column"
          paddingX={1}
        >
          <Text color={color(typing ? 'text' : 'muted')} bold={typing} backgroundColor={typing ? '#29292d' : undefined}>
            z   <Text color={color(typing ? 'accent' : 'ghost')}>○</Text>{' '}
            {draft
              ? question.secret
                ? '•'.repeat(Math.min(draft.length, inner - 8))
                : truncate(draft, inner - 8)
              : 'Type your answer here'}
            {typing ? <Text color={color('accent')}>▌</Text> : null}
          </Text>
        </Box>

        {contextLines.length > 0 ? (
          <Box flexDirection="column" paddingX={1} marginTop={compact ? 0 : 1}>
            {contextLines.slice(0, contextBudget).map((line, index) => (
              <Text key={index} color={color('ghost')}>{glyph.rail} {truncate(line, inner - 2)}</Text>
            ))}
            {hidden > 0 ? (
              <Text color={color('ghost')}>  … {hidden} more · Ctrl+E expand</Text>
            ) : null}
          </Box>
        ) : null}

        <Box justifyContent="space-between" paddingX={1} marginTop={compact ? 0 : 1}>
          <Text color={color('muted')}>
            [1/{total}]  ↑/↓ navigate  ·  type for Other
          </Text>
          <Text color={color('ghost')}><Text inverse bold> Enter </Text>:select</Text>
        </Box>
      </Box>
    </Box>
  );
}
