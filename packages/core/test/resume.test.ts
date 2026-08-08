import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conversationFromTranscript } from '../src/session/resume.js';
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

  it('folds a tool run into the assistant turn that made it', () => {
    const messages = conversationFromTranscript([
      user('quais arquivos?'),
      assistant('vou olhar'),
      tool('list_dir', { path: '/workspace' }, 'src\ntest'),
    ]);

    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.role, 'assistant');
    assert.match(messages[1]!.content, /vou olhar/);
    assert.match(messages[1]!.content, /list_dir/);
    assert.match(messages[1]!.content, /"path":"\/workspace"/);
    assert.match(messages[1]!.content, /→ ok/);
    assert.match(messages[1]!.content, /src\ntest/);
  });

  it('records a failed tool as failed', () => {
    const messages = conversationFromTranscript([
      assistant('tentando'),
      tool('run_command', { command: 'npm test' }, 'exit 1', false),
    ]);

    assert.match(messages[0]!.content, /→ failed/);
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

  it('keeps consecutive tool runs in one assistant turn', () => {
    const messages = conversationFromTranscript([
      assistant('trabalhando'),
      tool('read_file', { path: 'a.ts' }, 'a'),
      tool('read_file', { path: 'b.ts' }, 'b'),
    ]);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.content.match(/\[tool\]/g)?.length, 2);
  });

  it('opens an assistant turn for a tool that had no preceding message', () => {
    const messages = conversationFromTranscript([tool('read_file', { path: 'a.ts' }, 'a')]);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, 'assistant');
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

    assert.ok(messages[0]!.content.length < 500);
    assert.match(messages[0]!.content, /characters elided/);
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
