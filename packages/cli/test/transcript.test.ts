import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConversationEvent } from '@plif/core';
import {
  allTranscriptCells,
  initialTranscriptState,
  transcriptReducer,
} from '../src/transcript/reducer.js';

const at = '2026-08-11T12:00:00.000Z';

function user(eventId: string, turnId: string, text: string): ConversationEvent {
  return { version: 1, eventId, turnId, at, kind: 'user.message', text };
}

function assistant(
  eventId: string,
  turnId: string,
  text: string,
  phase: 'commentary' | 'final',
  reasoning?: string,
): ConversationEvent {
  return {
    version: 1,
    eventId,
    turnId,
    at,
    kind: 'assistant.message',
    text,
    phase,
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function toolStarted(
  eventId: string,
  turnId: string,
  callId: string,
  name: string,
): ConversationEvent {
  return {
    version: 1,
    eventId,
    turnId,
    at,
    kind: 'tool.started',
    call: { id: callId, name, arguments: '{}' },
  };
}

function toolCompleted(
  eventId: string,
  turnId: string,
  callId: string,
  ok: boolean,
): ConversationEvent {
  return {
    version: 1,
    eventId,
    turnId,
    at,
    kind: 'tool.completed',
    callId,
    output: ok ? 'ok' : 'exit 1',
    ok,
    durationMs: 5,
  };
}

describe('canonical transcript projection', () => {
  it('keeps user and assistant messages semantically distinct', () => {
    let state = transcriptReducer(initialTranscriptState, {
      type: 'event', event: user('u', 't', 'faça'),
    });
    state = transcriptReducer(state, {
      type: 'event', event: assistant('a', 't', 'feito', 'final'),
    });

    assert.deepEqual(allTranscriptCells(state).map((cell) => cell.kind), ['user', 'assistant']);
  });

  it('projects framed reasoning and answer, then replaces both durably byte-for-byte', () => {
    let state = transcriptReducer(initialTranscriptState, {
      type: 'event', event: user('u', 't', 'explique'),
    });
    state = transcriptReducer(state, {
      type: 'reasoning.frame', turnId: 't', at, epoch: 0, text: 'checking types',
    });
    state = transcriptReducer(state, {
      type: 'assistant.frame', turnId: 't', at, epoch: 0, text: 'resposta',
    });

    assert.equal(state.active?.kind, 'assistant');
    assert.equal(state.active?.kind === 'assistant' ? state.active.text : '', 'resposta');
    assert.equal(
      allTranscriptCells(state).find((cell) => cell.kind === 'reasoning')?.text,
      'checking types',
    );
    assert.equal(allTranscriptCells(state).filter((cell) => cell.kind === 'assistant').length, 1);

    state = transcriptReducer(state, {
      type: 'event', event: assistant('a', 't', 'resposta', 'final', 'checking types'),
    });
    assert.equal(allTranscriptCells(state).filter((cell) => cell.kind === 'reasoning').length, 1);
    assert.equal(allTranscriptCells(state).filter((cell) => cell.kind === 'assistant').length, 1);
    assert.equal(state.active?.id, 'a');
  });

  it('removes both ephemeral lanes when an attempt resets', () => {
    let state = transcriptReducer(initialTranscriptState, {
      type: 'reasoning.frame', turnId: 't', at, epoch: 0, text: 'abandoned reasoning',
    });
    state = transcriptReducer(state, {
      type: 'assistant.frame', turnId: 't', at, epoch: 0, text: 'abandoned answer',
    });
    state = transcriptReducer(state, { type: 'stream.reset', turnId: 't' });

    assert.deepEqual(allTranscriptCells(state), []);
  });

  it('coalesces routine tools within one turn', () => {
    let state = initialTranscriptState;
    state = transcriptReducer(state, {
      type: 'event', event: toolStarted('s1', 't', 'c1', 'read_file'),
    });
    state = transcriptReducer(state, {
      type: 'event', event: toolCompleted('r1', 't', 'c1', true),
    });
    state = transcriptReducer(state, {
      type: 'event', event: toolStarted('s2', 't', 'c2', 'list_dir'),
    });

    assert.equal(state.active?.kind, 'activity');
    assert.equal(state.active?.kind === 'activity' ? state.active.items.length : 0, 2);
  });

  it('does not create an empty assistant cell for a tool-only response', () => {
    let state = transcriptReducer(initialTranscriptState, {
      type: 'event',
      event: {
        ...assistant('a', 't', '', 'commentary'),
        toolCalls: [{ id: 'c', name: 'read_file', arguments: '{}' }],
      },
    });
    state = transcriptReducer(state, {
      type: 'event', event: toolStarted('s', 't', 'c', 'read_file'),
    });

    assert.deepEqual(allTranscriptCells(state).map((cell) => cell.kind), ['activity']);
  });

  it('promotes failed tools and diffs to dedicated cells', () => {
    let state = initialTranscriptState;
    state = transcriptReducer(state, {
      type: 'event', event: toolStarted('s1', 't', 'c1', 'run_command'),
    });
    state = transcriptReducer(state, {
      type: 'event', event: toolCompleted('r1', 't', 'c1', false),
    });
    state = transcriptReducer(state, {
      type: 'event', event: toolStarted('s2', 't', 'c2', 'apply_patch'),
    });
    state = transcriptReducer(state, {
      type: 'event',
      event: {
        ...toolCompleted('r2', 't', 'c2', true),
        diff: '@@ -1 +1 @@\n-old\n+new',
      },
    });

    assert.deepEqual(allTranscriptCells(state).map((cell) => cell.kind), ['error', 'diff']);
  });

  it('does not duplicate an event id during replay', () => {
    const event = user('same', 't', 'oi');
    const once = transcriptReducer(initialTranscriptState, { type: 'event', event });
    const twice = transcriptReducer(once, { type: 'event', event });

    assert.equal(twice, once);
  });

  it('finalizes active activity and records an interrupted boundary', () => {
    let state = transcriptReducer(initialTranscriptState, {
      type: 'event', event: toolStarted('s', 't', 'c', 'read_file'),
    });
    state = transcriptReducer(state, {
      type: 'event',
      event: {
        version: 1,
        eventId: 'end',
        turnId: 't',
        at,
        kind: 'turn.interrupted',
        reason: 'cancelled',
      },
    });

    assert.equal(state.active, null);
    assert.deepEqual(state.finalized.map((cell) => cell.kind), ['activity', 'notice']);
    assert.equal(state.finalized.every((cell) => cell.finalized), true);
  });

  it('keeps prior states immutable while a tool settles', () => {
    const before = transcriptReducer(initialTranscriptState, {
      type: 'event', event: toolStarted('s', 't', 'c', 'read_file'),
    });
    const after = transcriptReducer(before, {
      type: 'event', event: toolCompleted('r', 't', 'c', true),
    });

    assert.equal(before.active?.kind === 'activity' ? before.active.items[0]?.status : null, 'running');
    assert.equal(after.active?.kind === 'activity' ? after.active.items[0]?.status : null, 'done');
  });
});
