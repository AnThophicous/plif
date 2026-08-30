import React from 'react';
import { Box, Text } from 'ink';

import { color, formatDuration, glyph, truncate } from '../theme.js';

export type BtwPhase = 'working' | 'done' | 'error' | 'cancelled';

export interface BtwViewState {
  readonly id: number;
  readonly question: string;
  readonly phase: BtwPhase;
  readonly answer?: string;
  readonly error?: string;
  readonly startedAt: number;
}

interface BtwPanelProps {
  readonly state: BtwViewState | null;
  /** Non-null means the side-channel's small input surface owns the keyboard. */
  readonly draft?: string;
  readonly cursor?: number;
  readonly width: number;
  readonly now: number;
}

const MAX_ANSWER_LINES = 8;

function innerWidth(width: number): number {
  return Math.max(24, width - 4);
}

function answerLines(answer: string | undefined, width: number): readonly string[] {
  const lines = (answer?.trim() || 'working…').split('\n');
  const shown = lines.slice(0, MAX_ANSWER_LINES).map((line) => truncate(line, innerWidth(width) - 2));
  if (lines.length > MAX_ANSWER_LINES) shown.push(`… ${lines.length - MAX_ANSWER_LINES} more`);
  return shown;
}

export function btwPanelHeight(
  state: BtwViewState | null,
  draft: string | undefined,
  width: number,
): number {
  if (draft !== undefined) {
    const inputLines = Math.max(1, draft.split('\n').length);
    return 4 + inputLines;
  }
  if (!state) return 0;
  return 4 + Math.min(MAX_ANSWER_LINES, Math.max(1, answerLines(state.answer, width).length));
}

function CursorDraft({ draft, cursor, width }: { readonly draft: string; readonly cursor: number; readonly width: number }): React.ReactElement {
  const position = Math.max(0, Math.min(cursor, draft.length));
  const before = truncate(draft.slice(0, position), innerWidth(width) - 2);
  const remainingWidth = Math.max(1, innerWidth(width) - before.length - 1);
  const atCursor = draft[position] ?? ' ';
  const after = truncate(draft.slice(position + (position < draft.length ? 1 : 0)), remainingWidth);
  return (
    <Box>
      <Text color={color('accent')}>{glyph.prompt} </Text>
      <Text color={color('text')}>{before}</Text>
      <Text inverse color={color('text')}>{atCursor}</Text>
      <Text color={color('text')}>{after}</Text>
    </Box>
  );
}

/**
 * A quiet, non-modal side channel. It lives in the live frame rather than the
 * timeline, so asking a BTW question cannot become a fake turn in the main
 * session or compete with the agent's transcript.
 */
export function BtwPanel({ state, draft, cursor = 0, width, now }: BtwPanelProps): React.ReactElement | null {
  if (draft !== undefined) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Box justifyContent="space-between">
          <Text color={color('accent')} bold>{glyph.question} BTW · side question</Text>
          <Text color={color('ghost')}>does not touch the active turn</Text>
        </Box>
        <Text color={color('muted')}>Ask anything here; the answer is isolated and read-only.</Text>
        <CursorDraft draft={draft} cursor={cursor} width={width} />
        <Text color={color('ghost')}>Enter ask · Esc close · context is a safe snapshot</Text>
      </Box>
    );
  }

  if (!state) return null;
  const phaseLabel = state.phase === 'working'
    ? 'thinking'
    : state.phase === 'done'
      ? 'answer'
      : state.phase;
  const lines = answerLines(state.answer ?? state.error, width);
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color={color(state.phase === 'error' ? 'danger' : state.phase === 'cancelled' ? 'muted' : 'accent')} bold>
          {glyph.question} BTW · {phaseLabel}
        </Text>
        <Text color={color('ghost')}>{formatDuration(now - state.startedAt)}</Text>
      </Box>
      <Text color={color('muted')}>{truncate(`? ${state.question}`, innerWidth(width))}</Text>
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={`${state.id}:${index}`} color={color(state.phase === 'error' ? 'danger' : 'text')}>
            {glyph.rail} {line}
          </Text>
        ))}
      </Box>
      <Text color={color('ghost')}>/btw <Text color={color('muted')}>new question</Text> · /btw cancel</Text>
    </Box>
  );
}

