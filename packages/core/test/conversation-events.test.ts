import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import { QuestionBroker } from '../src/harness/ask.js';
import { runLoop } from '../src/harness/loop.js';
import type { Tool } from '../src/harness/tools.js';
import type { CompletionEvent, ModelProvider } from '../src/model/provider.js';
import type { ConversationEvent } from '../src/session/events.js';

function scripted(turns: readonly CompletionEvent[][]): ModelProvider {
  let turn = 0;
  return {
    info: { id: 'test', endpoint: 'test://', contextWindow: undefined },
    async *stream(): AsyncGenerator<CompletionEvent> {
      const events = turns[turn] ?? [];
      turn += 1;
      for (const event of events) yield event;
    },
    async probe() {
      return { ok: true, detail: 'test' };
    },
    async list() {
      return [];
    },
  };
}

const readFile: Tool = {
  spec: {
    name: 'read_file',
    description: 'read one file',
    parameters: { type: 'object', properties: {} },
  },
  async run() {
    return { output: 'conteúdo', display: 'a.ts', ok: true };
  },
};

const container = {
  name: 'test',
  workdir: '/workspace',
  capabilities: {},
} as unknown as Parameters<typeof runLoop>[1]['container'];

function capture(bus: EventBus): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  bus.on('conversation.event', (event) => events.push(event));
  return events;
}

describe('durable harness conversation events', () => {
  it('emits semantic boundaries in protocol order with one turn id', async () => {
    const bus = new EventBus();
    const events = capture(bus);
    const completionUsage: number[] = [];
    bus.on('agent.usage', (usage) => completionUsage.push(usage.completionTokens));

    const result = await runLoop([{ role: 'user', content: 'leia a.ts' }], {
      provider: scripted([
        [
          { kind: 'text', delta: 'Vou ler.' },
          { kind: 'tool', call: { id: 'call-1', name: 'read_file', arguments: '{"path":"a.ts"}' } },
          { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 10, completionTokens: 2 } },
        ],
        [
          { kind: 'text', delta: 'O arquivo está correto.' },
          { kind: 'done', reason: 'stop', usage: { promptTokens: 20, completionTokens: 4 } },
        ],
      ]),
      container,
      questions: new QuestionBroker(bus, 50),
      bus,
      tools: [readFile],
      turnId: 'turn-1',
    });

    assert.equal(result.stop, 'complete');
    assert.deepEqual(events.map((event) => event.kind), [
      'assistant.message',
      'tool.started',
      'tool.completed',
      'assistant.message',
      'turn.completed',
    ]);
    assert.deepEqual(new Set(events.map((event) => event.turnId)), new Set(['turn-1']));
    const started = events.find((event) => event.kind === 'tool.started');
    assert.equal(started?.kind === 'tool.started' ? started.call.id : null, 'call-1');
    const completed = events.find((event) => event.kind === 'tool.completed');
    assert.equal(completed?.kind === 'tool.completed' ? completed.output : null, 'conteúdo');
    assert.deepEqual(completionUsage, [2, 6]);
  });

  it('ends a cancelled stream with exactly one interruption event', async () => {
    const bus = new EventBus();
    const events = capture(bus);

    const result = await runLoop([{ role: 'user', content: 'pare' }], {
      provider: scripted([[
        { kind: 'done', reason: 'cancelled', usage: { promptTokens: 0, completionTokens: 0 } },
      ]]),
      container,
      questions: new QuestionBroker(bus, 50),
      bus,
      tools: [],
      turnId: 'turn-cancelled',
    });

    assert.equal(result.stop, 'cancelled');
    assert.deepEqual(events.map((event) => event.kind), ['turn.interrupted']);
  });

  it('ends a permanent provider failure with exactly one failed event', async () => {
    const bus = new EventBus();
    const events = capture(bus);
    const provider = scripted([]);
    provider.stream = async function* (): AsyncGenerator<CompletionEvent> {
      throw new Error('endpoint unavailable');
    };

    const result = await runLoop([{ role: 'user', content: 'continue' }], {
      provider,
      container,
      questions: new QuestionBroker(bus, 50),
      bus,
      tools: [],
      turnId: 'turn-failed',
    });

    assert.equal(result.stop, 'error');
    assert.deepEqual(events.map((event) => event.kind), ['turn.failed']);
    const failed = events[0];
    assert.match(failed?.kind === 'turn.failed' ? failed.reason : '', /endpoint unavailable/);
  });
});
