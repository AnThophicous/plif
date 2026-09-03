import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AnthropicProvider } from '../src/model/anthropic.js';
import { collect } from '../src/model/provider.js';
import type { ModelConfig } from '../src/model/config.js';

const CONFIG: ModelConfig = {
  model: 'claude-opus-5',
  baseURL: 'https://api.anthropic.com/v1',
  apiKey: 'test',
  temperature: 0,
  maxTokens: 1024,
  timeoutMs: 10_000,
};

interface Recorded {
  readonly bodies: Record<string, unknown>[];
}

/** A scripted client that records what the provider put on the wire. */
function scriptedClient(recorded: Recorded, failFirst = false): unknown {
  let calls = 0;
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
    },
    async finalMessage() {
      return { content: [], stop_reason: 'end_turn', usage: {} };
    },
  };
  return {
    messages: {
      stream(body: Record<string, unknown>) {
        recorded.bodies.push(body);
        calls += 1;
        if (failFirst && calls === 1) {
          throw Object.assign(new Error('cache_control: unsupported field'), { status: 400 });
        }
        return stream;
      },
    },
  };
}

const conversation = [
  { role: 'system' as const, content: 'you are plif' },
  { role: 'user' as const, content: 'hello' },
];

function breakpointsIn(body: Record<string, unknown>): number {
  return JSON.stringify(body).split('"cache_control"').length - 1;
}

describe('anthropic prompt caching', () => {
  it('marks the tools, the system prompt and the newest message', async () => {
    const recorded: Recorded = { bodies: [] };
    const provider = new AnthropicProvider(CONFIG, { client: scriptedClient(recorded) as never });
    await collect(provider.stream({
      messages: conversation,
      tools: [
        { name: 'read_file', description: 'read', parameters: {} },
        { name: 'run_command', description: 'run', parameters: {} },
      ],
    }));

    const body = recorded.bodies[0]!;
    // The tool list never varies with session state, so it caches on its own.
    const tools = body['tools'] as { name: string; cache_control?: unknown }[];
    assert.equal(tools[0]?.cache_control, undefined);
    assert.ok(tools.at(-1)?.cache_control);

    const system = body['system'] as { text: string; cache_control?: unknown }[];
    assert.equal(Array.isArray(system), true);
    assert.equal(system[0]?.text, 'you are plif');
    assert.ok(system.at(-1)?.cache_control);

    // The last breakpoint rides the newest message, which is the prefix the
    // next turn reads back.
    const messages = body['messages'] as { content: { cache_control?: unknown }[] }[];
    assert.ok(messages.at(-1)?.content.at(-1)?.cache_control);
    assert.equal(breakpointsIn(body), 3);
  });

  it('does not restart a stream that already produced output', async () => {
    // A mid-stream failure cannot be retried: whatever was yielded is already
    // in the transcript, and running the turn again would duplicate it.
    const recorded: Recorded = { bodies: [] };
    const failing = {
      messages: {
        stream(body: Record<string, unknown>) {
          recorded.bodies.push(body);
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
              throw Object.assign(new Error('cache_control failed'), { status: 400 });
            },
            async finalMessage() {
              return { content: [], stop_reason: 'end_turn', usage: {} };
            },
          };
        },
      },
    };
    const provider = new AnthropicProvider(CONFIG, { client: failing as never });
    await assert.rejects(() => collect(provider.stream({ messages: conversation })));
    assert.equal(recorded.bodies.length, 1);
  });

  it('drops caching for the rest of the run when an endpoint rejects it', async () => {
    const recorded: Recorded = { bodies: [] };
    const provider = new AnthropicProvider(CONFIG, {
      client: scriptedClient(recorded, true) as never,
    });

    // The rejected attempt is retried once, without the field.
    await collect(provider.stream({ messages: conversation }));
    assert.equal(recorded.bodies.length, 2);
    assert.equal(breakpointsIn(recorded.bodies[0]!), 2);
    assert.equal(breakpointsIn(recorded.bodies[1]!), 0);
    assert.equal(typeof recorded.bodies[1]!['system'], 'string');

    // A later turn does not pay for the same rejection again.
    await collect(provider.stream({ messages: conversation }));
    assert.equal(recorded.bodies.length, 3);
    assert.equal(breakpointsIn(recorded.bodies[2]!), 0);
  });
});
