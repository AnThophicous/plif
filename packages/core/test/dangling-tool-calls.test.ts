import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answerDanglingToolCalls } from '../src/harness/loop.js';
import type { Message } from '../src/model/provider.js';

const asked = (...ids: string[]): Message => ({
  role: 'assistant',
  content: '',
  toolCalls: ids.map((id) => ({ id, name: 'run_command', arguments: '{}' })),
});

const answered = (id: string): Message => ({
  role: 'tool',
  content: 'ok',
  toolCallId: id,
});

describe('a turn stopped between the tool request and the tool result', () => {
  it('leaves a complete exchange exactly as it was', () => {
    const messages: Message[] = [
      { role: 'user', content: 'run the tests' },
      asked('call_1'),
      answered('call_1'),
      { role: 'assistant', content: 'they pass' },
    ];

    assert.deepEqual(answerDanglingToolCalls(messages, 'complete'), messages);
  });

  it('answers a call the cancel interrupted, so the next request is well formed', () => {
    const reconciled = answerDanglingToolCalls(
      [{ role: 'user', content: 'run the tests' }, asked('call_1')],
      'cancelled',
    );

    assert.equal(reconciled.length, 3);
    assert.equal(reconciled[2]?.role, 'tool');
    assert.equal(reconciled[2]?.toolCallId, 'call_1');
    assert.match(reconciled[2]?.content ?? '', /Cancelled by the developer/);
  });

  it('answers every unanswered call in a parallel batch, and only those', () => {
    const reconciled = answerDanglingToolCalls(
      [asked('call_1', 'call_2', 'call_3'), answered('call_2')],
      'cancelled',
    );

    const results = reconciled.filter((message) => message.role === 'tool');
    assert.deepEqual(
      [...results.map((message) => message.toolCallId)].sort(),
      ['call_1', 'call_2', 'call_3'],
    );
    assert.equal(results.filter((message) => message.content === 'ok').length, 1);
    assert.equal(reconciled[0]?.role, 'assistant');
  });

  it('places each synthetic result directly after the message that asked', () => {
    const reconciled = answerDanglingToolCalls(
      [asked('call_1'), { role: 'user', content: 'never mind' }],
      'cancelled',
    );

    assert.deepEqual(
      reconciled.map((message) => message.role),
      ['assistant', 'tool', 'user'],
    );
  });

  it('says the turn ended rather than blaming the developer when it was not a cancel', () => {
    const reconciled = answerDanglingToolCalls([asked('call_1')], 'failed');
    assert.match(reconciled[1]?.content ?? '', /turn ended/);
  });

  it('is a no-op for a conversation with no tool calls at all', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    assert.deepEqual(answerDanglingToolCalls(messages, 'cancelled'), messages);
  });
});
