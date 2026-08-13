import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adaptLegacyTranscriptEvent,
  decodeConversationEvent,
  decodeLegacyTranscriptEvent,
  dedupeConversationEvents,
  recoverInterruptedTurns,
} from '../src/session/events.js';

const at = '2026-08-11T12:00:00.000Z';

describe('canonical conversation events', () => {
  it('decodes a versioned assistant message with tool calls', () => {
    const decoded = decodeConversationEvent({
      version: 1,
      eventId: 'evt-1',
      turnId: 'turn-1',
      at,
      kind: 'assistant.message',
      phase: 'commentary',
      text: 'vou verificar',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.ts"}' }],
    });

    assert.equal(decoded?.kind, 'assistant.message');
    assert.equal(decoded?.turnId, 'turn-1');
    assert.deepEqual(decoded?.kind === 'assistant.message' ? decoded.toolCalls : undefined, [
      { id: 'call-1', name: 'read_file', arguments: '{"path":"a.ts"}' },
    ]);
  });

  it('rejects malformed and unknown records without throwing', () => {
    assert.equal(decodeConversationEvent({ version: 1, kind: 'assistant.message' }), null);
    assert.equal(decodeConversationEvent({
      version: 1,
      eventId: 'evt-1',
      turnId: 'turn-1',
      at,
      kind: 'future.event',
    }), null);
    assert.equal(decodeConversationEvent('not-an-object'), null);
  });

  it('adapts legacy messages without changing their roles', () => {
    let id = 0;
    const context = { turnId: 'legacy-turn-1', nextEventId: () => `legacy-${++id}` };
    const user = adaptLegacyTranscriptEvent({ kind: 'user', at, text: 'faça' }, context);
    const assistant = adaptLegacyTranscriptEvent({ kind: 'assistant', at, text: 'feito' }, context);

    assert.equal(user?.kind, 'user.message');
    assert.equal(assistant?.kind, 'assistant.message');
    assert.equal(assistant?.kind === 'assistant.message' ? assistant.phase : null, 'final');
  });

  it('validates legacy records before adapting them', () => {
    assert.deepEqual(decodeLegacyTranscriptEvent({ kind: 'user', at, text: 'oi' }), {
      kind: 'user', at, text: 'oi',
    });
    assert.equal(decodeLegacyTranscriptEvent({ kind: 'tool', at, tool: 'read_file' }), null);
    assert.equal(decodeLegacyTranscriptEvent({ kind: 'future', at }), null);
  });

  it('adapts legacy tools as labeled historical context', () => {
    const event = adaptLegacyTranscriptEvent(
      {
        kind: 'tool',
        at,
        tool: 'read_file',
        input: { path: 'a.ts' },
        output: 'contents',
        ok: true,
        durationMs: 4,
      },
      { turnId: 'legacy-turn-1', nextEventId: () => 'legacy-tool' },
    );

    assert.equal(event?.kind, 'history.context');
    assert.match(event?.kind === 'history.context' ? event.text : '', /^\[historical tool activity\]/);
    assert.match(event?.kind === 'history.context' ? event.text : '', /read_file/);
  });

  it('is idempotent by event id while preserving order', () => {
    const first = decodeConversationEvent({
      version: 1,
      eventId: 'same',
      turnId: 't',
      at,
      kind: 'user.message',
      text: 'oi',
    })!;
    const second = decodeConversationEvent({
      version: 1,
      eventId: 'other',
      turnId: 't',
      at,
      kind: 'assistant.message',
      phase: 'final',
      text: 'olá',
    })!;

    assert.deepEqual(dedupeConversationEvents([first, first, second]), [first, second]);
  });

  it('recovers one unfinished turn exactly once', () => {
    const events = [
      { version: 1, eventId: 'u', turnId: 't', at, kind: 'user.message', text: 'rode' },
      { version: 1, eventId: 's', turnId: 't', at, kind: 'turn.started', userEventId: 'u' },
    ] as const;
    const recovered = recoverInterruptedTurns(events, '2026-08-11T12:01:00.000Z');

    assert.deepEqual(recovered.map((event) => event.kind), [
      'user.message',
      'turn.started',
      'turn.interrupted',
    ]);
    assert.equal(recoverInterruptedTurns(recovered, at).length, recovered.length);
  });

  it('does not interrupt a turn that already ended', () => {
    const events = [
      { version: 1, eventId: 's', turnId: 't', at, kind: 'turn.started', userEventId: 'u' },
      { version: 1, eventId: 'e', turnId: 't', at, kind: 'turn.completed', durationMs: 10 },
    ] as const;

    assert.deepEqual(recoverInterruptedTurns(events, at), events);
  });
});
