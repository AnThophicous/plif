import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  conversationFromTranscript,
  decodeConversationEvent,
  recoverInterruptedTurns,
} from '@plif/core';
import type { ConversationEvent } from '@plif/core';
import {
  allTranscriptCells,
  initialTranscriptState,
  transcriptReducer,
} from '../src/transcript/reducer.js';

const at = '2026-08-11T12:00:00.000Z';

function project(events: readonly ConversationEvent[]) {
  return events.reduce(
    (state, event) => transcriptReducer(state, { type: 'event', event }),
    initialTranscriptState,
  );
}

describe('canonical session round trip', () => {
  it('projects live and decoded JSONL identically and restores provider roles', () => {
    const events: ConversationEvent[] = [
      { version: 1, eventId: 'u', turnId: 't', at, kind: 'user.message', text: 'leia a.ts' },
      { version: 1, eventId: 'ts', turnId: 't', at, kind: 'turn.started', userEventId: 'u' },
      {
        version: 1,
        eventId: 'a1',
        turnId: 't',
        at,
        kind: 'assistant.message',
        phase: 'commentary',
        text: 'Vou conferir.',
        toolCalls: [{ id: 'c', name: 'read_file', arguments: '{"path":"a.ts"}' }],
      },
      {
        version: 1,
        eventId: 's',
        turnId: 't',
        at,
        kind: 'tool.started',
        call: { id: 'c', name: 'read_file', arguments: '{"path":"a.ts"}' },
      },
      {
        version: 1,
        eventId: 'r',
        turnId: 't',
        at,
        kind: 'tool.completed',
        callId: 'c',
        output: 'conteúdo',
        ok: true,
        durationMs: 4,
      },
      {
        version: 1,
        eventId: 'a2',
        turnId: 't',
        at,
        kind: 'assistant.message',
        phase: 'final',
        text: 'Está correto.',
      },
      { version: 1, eventId: 'tc', turnId: 't', at, kind: 'turn.completed', durationMs: 9 },
    ];
    const decoded = events
      .map((event) => decodeConversationEvent(JSON.parse(JSON.stringify(event))))
      .filter((event): event is ConversationEvent => event !== null);

    assert.deepEqual(
      allTranscriptCells(project(decoded)).map(({ kind, turnId }) => ({ kind, turnId })),
      allTranscriptCells(project(events)).map(({ kind, turnId }) => ({ kind, turnId })),
    );
    assert.deepEqual(conversationFromTranscript(decoded), [
      { role: 'user', content: 'leia a.ts' },
      {
        role: 'assistant',
        content: 'Vou conferir.',
        toolCalls: [{ id: 'c', name: 'read_file', arguments: '{"path":"a.ts"}' }],
      },
      { role: 'tool', content: 'conteúdo', toolCallId: 'c' },
      { role: 'assistant', content: 'Está correto.' },
    ]);
  });

  it('recovers an unfinished turn as one settled interruption notice', () => {
    const unfinished: ConversationEvent[] = [
      { version: 1, eventId: 'u', turnId: 't', at, kind: 'user.message', text: 'rode os testes' },
      { version: 1, eventId: 'ts', turnId: 't', at, kind: 'turn.started', userEventId: 'u' },
      {
        version: 1,
        eventId: 'as',
        turnId: 't',
        at,
        kind: 'tool.started',
        call: { id: 'c', name: 'run_command', arguments: '{"command":"npm test"}' },
      },
    ];
    const recovered = recoverInterruptedTurns(unfinished, '2026-08-11T12:01:00.000Z');
    const state = project(recovered);

    assert.equal(state.active, null);
    assert.equal(allTranscriptCells(state).filter((cell) => cell.kind === 'notice').length, 1);
    assert.equal(recoverInterruptedTurns(recovered, at).length, recovered.length);
  });
});
