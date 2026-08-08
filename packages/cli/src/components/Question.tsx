import React from 'react';
import { Box, Text } from 'ink';

import type { PendingQuestion } from '../session.js';
import { color, formatDuration, glyph, layout, truncate } from '../theme.js';

interface QuestionProps {
  readonly question: PendingQuestion;
  /** Highlighted suggestion, or -1 while a free answer is being typed. */
  readonly selected: number;
  readonly draft: string;
  readonly queued: number;
  readonly width: number;
  readonly expanded: boolean;
  readonly compact?: boolean;
  /** Redrawn on a timer so the elapsed counter moves. */
  readonly now: number;
}

/** Context lines shown before the fold. */
const CONTEXT_PREVIEW = 4;
const CONTEXT_EXPANDED = 14;

/**
 * Worst-case height, for the caller's layout budget.
 *
 * Overestimating costs a row of scrollback; underestimating puts the frame at
 * terminal height and makes Ink reprint the whole session.
 */
export function questionHeight(
  question: PendingQuestion,
  compact: boolean,
  expanded: boolean,
): number {
  const contextLines = question.context
    ? Math.min(
        question.context.split('\n').length,
        expanded ? CONTEXT_EXPANDED : CONTEXT_PREVIEW,
      ) + 2
    : 0;
  const options = question.options?.length ?? 0;
  return 2 + 2 + (compact ? 1 : 2) + contextLines + options + 2 + (compact ? 0 : 2);
}

/**
 * The agent asking the human something.
 *
 * This panel exists because its absence was a hang. `create_profile` asks for
 * confirmation before writing to the global config — correctly — and with
 * nothing rendering `question.asked`, the tool sat on the broker until its
 * ten-minute timeout while the spinner said "working". The developer saw an
 * agent that never finished; what was actually happening is that it was waiting
 * for them.
 *
 * So the panel is built to make the wait obviously *theirs*: the elapsed
 * counter runs in the header, the question is the brightest thing on it, and
 * there is always a visible way to answer — a highlighted suggestion, or a
 * cursor to type into. It never shows only suggestions, because the broker
 * accepts free text and a list that looks closed would hide that.
 */
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
  const inner = width - 4;
  const gap = compact ? 0 : 1;
  const options = question.options ?? [];
  const typing = selected < 0;
  const waited = now - question.askedAt;

  const contextLines = question.context?.replace(/\s+$/, '').split('\n') ?? [];
  const budget = expanded ? CONTEXT_EXPANDED : CONTEXT_PREVIEW;
  const hidden = Math.max(0, contextLines.length - budget);

  return (
    <Box flexDirection="column" width="100%" marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color('info')}
        paddingX={layout.boxPadX}
        width="100%"
      >
        <Box justifyContent="space-between">
          <Text color={color('info')} bold>
            {glyph.waiting} {question.secret ? 'a credential is needed' : 'the agent is asking you'}
          </Text>
          <Text color={color('ghost')}>
            waiting {formatDuration(waited)}
            {queued > 0 ? `  +${queued} queued` : ''}
          </Text>
        </Box>

        <Box marginTop={gap}>
          <Text color={color('ghost')}>{glyph.caret} </Text>
          <Text color={color('text')} bold>
            {truncate(question.text, inner - 2)}
          </Text>
        </Box>

        {/*
          The state behind the question, on a rail.
          For `create_profile` this is the whole proposal — the model and the
          system prompt it wants to save — and it is the only place the
          developer can read what they are agreeing to before they agree.
        */}
        {contextLines.length > 0 && (
          <Box flexDirection="column" marginTop={gap}>
            {contextLines.slice(0, budget).map((line, index) => (
              <Box key={index}>
                <Text color={color('ghost')}>{glyph.rail} </Text>
                <Text color={color('muted')}>{truncate(line, inner - 2)}</Text>
              </Box>
            ))}
            {hidden > 0 && (
              <Box>
                <Text color={color('ghost')}>{glyph.rail} </Text>
                <Text color={color('ghost')} italic>
                  … {hidden} more {hidden === 1 ? 'line' : 'lines'} — Ctrl+E to expand
                </Text>
              </Box>
            )}
          </Box>
        )}

        {options.length > 0 && (
          <Box flexDirection="column" marginTop={gap}>
            {options.map((option, index) => {
              const active = index === selected;
              return (
                <Box key={option}>
                  <Text color={color(active ? 'accent' : 'ghost')}>
                    {active ? glyph.caret : ' '}{' '}
                  </Text>
                  <Text color={color(active ? 'text' : 'faint')} bold={active}>
                    {truncate(option, inner - 4)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Always present. The broker takes any string, and a panel that showed
            only the suggestions would make the shortcut look like the limit. */}
        <Box marginTop={gap}>
          <Text color={color(typing ? 'accent' : 'ghost')}>{glyph.prompt} </Text>
          {draft ? (
            <Text color={color('text')}>
              {/* Masked rather than truncated: a credential must not be
                  readable over a shoulder or in a recorded terminal. */}
              {question.secret ? '•'.repeat(Math.min(draft.length, inner - 4)) : truncate(draft, inner - 4)}
              <Text color={color('accent')}>▌</Text>
            </Text>
          ) : (
            <Text color={color('ghost')} italic>
              {question.secret
                ? 'paste or type it — nothing is echoed, and it is stored encrypted'
                : options.length
                  ? 'or type a different answer'
                  : 'type your answer'}
              {typing ? <Text color={color('accent')}>▌</Text> : null}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
