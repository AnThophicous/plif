import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Message } from '@plif/core';

import { withoutReasoning } from '../src/conversation.js';

describe('carrying the conversation across a provider change', () => {
  const exchange: Message[] = [
    { role: 'user', content: 'why are the 401s intermittent?' },
    { role: 'assistant', content: 'The JWKS cache.', reasoning: 'a page of private thinking' },
    { role: 'user', content: 'fix it' },
  ];

  it('keeps every message', () => {
    assert.equal(withoutReasoning(exchange).length, exchange.length);
    assert.deepEqual(
      withoutReasoning(exchange).map((message) => message.content),
      ['why are the 401s intermittent?', 'The JWKS cache.', 'fix it'],
    );
  });

  it('drops reasoning the new provider never produced', () => {
    const carried = withoutReasoning(exchange);
    assert.equal(carried[1]?.reasoning, undefined);
    assert.equal('reasoning' in (carried[1] as object), false);
  });

  it('leaves messages that never had reasoning untouched by identity', () => {
    const carried = withoutReasoning(exchange);
    assert.equal(carried[0], exchange[0]);
    assert.equal(carried[2], exchange[2]);
  });

  it('preserves tool calls and their results', () => {
    const withTools: Message[] = [
      {
        role: 'assistant',
        content: '',
        reasoning: 'thinking about it',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }],
      },
      { role: 'tool', content: 'file contents', toolCallId: 'call_1' },
    ];
    const carried = withoutReasoning(withTools);
    assert.deepEqual(carried[0]?.toolCalls, withTools[0]?.toolCalls);
    assert.equal(carried[1]?.toolCallId, 'call_1');
  });

  it('does nothing to an empty conversation', () => {
    assert.deepEqual(withoutReasoning([]), []);
  });
});
