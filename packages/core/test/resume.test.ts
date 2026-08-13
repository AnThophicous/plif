import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conversationFromTranscript } from '../src/session/resume.js';
import type { ConversationEvent } from '../src/session/events.js';
import type { TranscriptEvent } from '../src/session/store.js';

const at = '2026-08-08T12:00:00.000Z';

const user = (text: string): TranscriptEvent => ({ kind: 'user', at, text });
const assistant = (text: string): TranscriptEvent => ({ kind: 'assistant', at, text });
const tool = (
  name: string,
  input: Record<string, unknown>,
  output: string,
  ok = true,
): TranscriptEvent => ({ kind: 'tool', at, tool: name, input, output, ok, durationMs: 12 });

describe('resuming a conversation', () => {
  it('restores an assistant tool call followed by its tool result', () => {
    const events: ConversationEvent[] = [
      { version: 1, eventId: 'u', turnId: 't', at, kind: 'user.message', text: 'leia a.ts' },
      {
        version: 1,
        eventId: 'a',
        turnId: 't',
        at,
        kind: 'assistant.message',
        phase: 'commentary',
        text: 'vou ler',
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
    ];

    assert.deepEqual(conversationFromTranscript(events), [
      { role: 'user', content: 'leia a.ts' },
      {
        role: 'assistant',
        content: 'vou ler',
        toolCalls: [{ id: 'c', name: 'read_file', arguments: '{"path":"a.ts"}' }],
      },
      { role: 'tool', content: 'conteúdo', toolCallId: 'c' },
    ]);
  });

  it('does not emit an orphaned tool result as a tool-role message', () => {
    const events: ConversationEvent[] = [{
      version: 1,
      eventId: 'r',
      turnId: 't',
      at,
      kind: 'tool.completed',
      callId: 'missing',
      output: 'x',
      ok: false,
      durationMs: 1,
    }];

    assert.deepEqual(conversationFromTranscript(events), []);
  });

  it('replays legacy tool activity as labeled user context, never assistant authorship', () => {
    const messages = conversationFromTranscript([
      assistant('vou olhar'),
      tool('read_file', { path: 'a.ts' }, 'conteúdo'),
    ]);

    assert.equal(messages[0]?.role, 'assistant');
    assert.equal(messages[1]?.role, 'user');
    assert.match(messages[1]?.content ?? '', /^\[historical tool activity\]/);
  });

  it('rebuilds the exchange in order', () => {
    const messages = conversationFromTranscript([
      user('adiciona um teste'),
      assistant('feito'),
      user('e agora roda'),
    ]);

    assert.deepEqual(messages, [
      { role: 'user', content: 'adiciona um teste' },
      { role: 'assistant', content: 'feito' },
      { role: 'user', content: 'e agora roda' },
    ]);
  });

  it('keeps legacy tool output as labeled context after the assistant', () => {
    const messages = conversationFromTranscript([
      user('quais arquivos?'),
      assistant('vou olhar'),
      tool('list_dir', { path: '/workspace' }, 'src\ntest'),
    ]);

    assert.equal(messages.length, 3);
    assert.equal(messages[1]?.role, 'assistant');
    assert.match(messages[1]!.content, /vou olhar/);
    assert.equal(messages[2]?.role, 'user');
    assert.match(messages[2]!.content, /^\[historical tool activity\]/);
    assert.match(messages[2]!.content, /list_dir/);
    assert.match(messages[2]!.content, /"path":"\/workspace"/);
    assert.match(messages[2]!.content, /→ ok/);
    assert.match(messages[2]!.content, /src\ntest/);
  });

  it('records a failed tool as failed', () => {
    const messages = conversationFromTranscript([
      assistant('tentando'),
      tool('run_command', { command: 'npm test' }, 'exit 1', false),
    ]);

    assert.equal(messages[1]?.role, 'user');
    assert.match(messages[1]!.content, /→ failed/);
  });

  it('never emits a tool-role message, which would have no call to answer', () => {
    const messages = conversationFromTranscript([
      user('vai'),
      assistant('ok'),
      tool('read_file', { path: 'a.ts' }, 'conteudo'),
      tool('write_file', { path: 'b.ts' }, 'escrito'),
    ]);

    assert.equal(
      messages.some((message) => message.role === 'tool'),
      false,
    );
    assert.equal(
      messages.some((message) => message.toolCalls !== undefined || message.toolCallId !== undefined),
      false,
    );
  });

  it('keeps consecutive legacy tool runs as separate labeled context', () => {
    const messages = conversationFromTranscript([
      assistant('trabalhando'),
      tool('read_file', { path: 'a.ts' }, 'a'),
      tool('read_file', { path: 'b.ts' }, 'b'),
    ]);

    assert.equal(messages.length, 3);
    assert.equal(messages[0]?.role, 'assistant');
    assert.equal(messages[1]?.role, 'user');
    assert.equal(messages[2]?.role, 'user');
    assert.match(messages[1]!.content, /^\[historical tool activity\]/);
    assert.match(messages[2]!.content, /^\[historical tool activity\]/);
  });

  it('labels an orphaned legacy tool as user-provided historical context', () => {
    const messages = conversationFromTranscript([tool('read_file', { path: 'a.ts' }, 'a')]);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, 'user');
    assert.match(messages[0]!.content, /^\[historical tool activity\]/);
  });

  it('restores a compaction boundary the way a live compaction writes it', () => {
    const messages = conversationFromTranscript([
      { kind: 'compaction', at, summary: 'discutimos o parser', replacedEvents: 40 },
      user('continua'),
    ]);

    assert.deepEqual(messages[0], {
      role: 'user',
      content: '[earlier turns, summarised]\ndiscutimos o parser',
    });
  });

  it('clips a large tool output instead of carrying it whole', () => {
    const messages = conversationFromTranscript(
      [assistant('lendo'), tool('read_file', { path: 'big.ts' }, 'x'.repeat(5_000))],
      { toolOutputLimit: 100 },
    );

    assert.ok(messages[1]!.content.length < 500);
    assert.match(messages[1]!.content, /characters elided/);
  });

  it('drops notes and empty turns, which carry nothing the model can use', () => {
    const messages = conversationFromTranscript([
      { kind: 'note', at, text: 'container criado', level: 'info' },
      user('   '),
      assistant(''),
      user('oi'),
    ]);

    assert.deepEqual(messages, [{ role: 'user', content: 'oi' }]);
  });

  it('returns nothing for an empty transcript', () => {
    assert.deepEqual(conversationFromTranscript([]), []);
  });
});
