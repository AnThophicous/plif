/**
 * Messages typed while the agent is working.
 *
 * The behaviour worth pinning is *where* they land. A queued correction that
 * arrives after the work it was meant to redirect is worthless, and one
 * delivered twice makes the model think it was said twice.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import type { PlifEvents } from '../src/events/bus.js';
import { runLoop } from '../src/harness/loop.js';
import { QuestionBroker } from '../src/harness/ask.js';
import type { Message } from '../src/model/provider.js';
import type { Tool } from '../src/harness/tools.js';
import type { CompletionEvent, CompletionRequest, ModelProvider } from '../src/model/provider.js';

/** A provider that plays a fixed script of turns. */
function scripted(
  turns: readonly CompletionEvent[][],
  onRequest?: (request: CompletionRequest) => void,
): ModelProvider {
  let turn = 0;
  return {
    info: { id: 'test', endpoint: 'test://', contextWindow: undefined },
    async *stream(request): AsyncGenerator<CompletionEvent> {
      onRequest?.(request);
      const events = turns[turn] ?? [{ kind: 'done', reason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } }];
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

const noopTool: Tool = {
  spec: { name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } },
  async run() {
    return { output: 'pong', ok: true };
  },
};

function toolTurn(id: string): CompletionEvent[] {
  return [
    { kind: 'tool', call: { id, name: 'ping', arguments: '{}' } },
    { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 0, completionTokens: 0 } },
  ];
}

const finalTurn: CompletionEvent[] = [
  { kind: 'text', delta: 'done' },
  { kind: 'done', reason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } },
];

function harness(queue: string[][]): {
  bus: EventBus;
  questions: QuestionBroker;
  drainQueue: () => readonly string[];
  drains: number;
} {
  const bus = new EventBus();
  const state = { drains: 0 };
  return {
    bus,
    questions: new QuestionBroker(bus, 50),
    drainQueue: () => {
      const batch = queue[state.drains] ?? [];
      state.drains += 1;
      return batch;
    },
    get drains() {
      return state.drains;
    },
  };
}

const container = {
  name: 'test',
  workdir: '/w',
  capabilities: {},
} as unknown as Parameters<typeof runLoop>[1]['container'];

describe('the answer collected across turns', () => {
  it('keeps clipped pre-tool prose in protocol history but hides it from the visible answer', async () => {
    const bus = new EventBus();
    const prose: PlifEvents['agent.pre_tool_prose'][] = [];
    bus.on('agent.pre_tool_prose', (event) => prose.push(event));
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([
        [
          { kind: 'text', delta: 'Vou ler a assinatura exata para ficar fiel ao contrato da' },
          { kind: 'tool', call: { id: 'c1', name: 'ping', arguments: '{}' } },
          { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 0, completionTokens: 0 } },
        ],
        [
          { kind: 'text', delta: 'Tenho o contrato completo.' },
          { kind: 'done', reason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } },
        ],
      ]),
      container,
      questions: new QuestionBroker(bus, 50),
      bus,
      tools: [noopTool],
      turnId: 'turn-clipped-prose',
    });

    assert.equal(result.text, 'Tenho o contrato completo.');
    assert.equal(
      result.messages.find((message) => message.role === 'assistant')?.content,
      'Vou ler a assinatura exata para ficar fiel ao contrato da',
    );
    assert.deepEqual(prose, [{
      turnId: 'turn-clipped-prose',
      iteration: 1,
      text: 'Vou ler a assinatura exata para ficar fiel ao contrato da',
      visibility: 'transient',
    }]);
  });

  it('keeps complete pre-tool prose as activity without returning it as the answer', async () => {
    const bus = new EventBus();
    const prose: PlifEvents['agent.pre_tool_prose'][] = [];
    bus.on('agent.pre_tool_prose', (event) => prose.push(event));
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([
        [
          { kind: 'text', delta: 'Vou confirmar a configuração primeiro.' },
          { kind: 'tool', call: { id: 'c1', name: 'ping', arguments: '{}' } },
          { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 0, completionTokens: 0 } },
        ],
        [
          { kind: 'text', delta: 'A configuração está correta.' },
          { kind: 'done', reason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } },
        ],
      ]),
      container,
      questions: new QuestionBroker(bus, 50),
      bus,
      tools: [noopTool],
      turnId: 'turn-complete-prose',
    });

    assert.equal(result.text, 'A configuração está correta.');
    assert.equal(
      result.messages.find((message) => message.role === 'assistant')?.content,
      'Vou confirmar a configuração primeiro.',
    );
    assert.deepEqual(prose, [{
      turnId: 'turn-complete-prose',
      iteration: 1,
      text: 'Vou confirmar a configuração primeiro.',
      visibility: 'activity',
    }]);
  });

  it('does not open with a blank paragraph when the first turn is silent', async () => {
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([toolTurn('c1'), finalTurn]),
      container,
      questions: new QuestionBroker(new EventBus(), 50),
      bus: new EventBus(),
      tools: [noopTool],
    });

    assert.equal(result.text, 'done');
  });
});

describe('queued messages', () => {
  it('does not replay malformed tool arguments to the next model turn', async () => {
    const requests: CompletionRequest[] = [];
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([
        [
          { kind: 'tool', call: { id: 'bad-1', name: 'ping', arguments: '{"oops":' } },
          { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 0, completionTokens: 0 } },
        ],
        finalTurn,
      ], (request) => requests.push(request)),
      container,
      questions: new QuestionBroker(new EventBus(), 50),
      bus: new EventBus(),
      tools: [noopTool],
    });

    const assistant = result.messages.find((message) => message.role === 'assistant');
    assert.equal(assistant?.toolCalls?.[0]?.id, 'bad-1');
    assert.equal(assistant?.toolCalls?.[0]?.arguments, '{}');
    assert.match(result.messages.find((message) => message.role === 'tool')?.content ?? '', /not valid JSON/);

    const replayed = requests[1]?.messages.find((message) => message.role === 'assistant');
    assert.equal(replayed?.toolCalls?.[0]?.arguments, '{}');
    assert.equal(result.stop, 'complete');
  });

  it('lands after the tool result and before the next turn', async () => {
    // The order is the whole point: the model reads the tool result and the
    // correction in the same pass, while there is still time to act on it.
    const stub = harness([['also check the Windows path']]);
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([toolTurn('c1'), finalTurn]),
      container,
      questions: stub.questions,
      bus: stub.bus,
      tools: [noopTool],
      drainQueue: stub.drainQueue,
    });

    const roles = result.messages.map((message) => `${message.role}:${message.content.slice(0, 12)}`);
    const toolIndex = roles.findIndex((entry) => entry.startsWith('tool:'));
    const queuedIndex = result.messages.findIndex((message) =>
      message.content.includes('also check the Windows path'),
    );

    assert.ok(toolIndex >= 0, 'the tool result should be in the transcript');
    assert.ok(queuedIndex > toolIndex, 'the queued message must come after the tool result');
    assert.equal(result.messages[queuedIndex]?.role, 'user');
  });

  it('marks it as having arrived mid-turn', async () => {
    // Without the label the model reads it as the original request restated,
    // and cannot tell that the work already done was based on the older one.
    const stub = harness([['actually make it blue']]);
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([toolTurn('c1'), finalTurn]),
      container,
      questions: stub.questions,
      bus: stub.bus,
      tools: [noopTool],
      drainQueue: stub.drainQueue,
    });

    const queued = result.messages.find((message: Message) =>
      message.content.includes('actually make it blue'),
    );
    assert.match(queued?.content ?? '', /while you were working/i);
  });

  it('delivers each message once across several tool calls', async () => {
    // The drain is called at every boundary. A queue that was read rather than
    // taken would re-deliver the same line on each one.
    const seen: number[] = [];
    const stub = harness([['first'], [], []]);
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([toolTurn('c1'), toolTurn('c2'), toolTurn('c3'), finalTurn]),
      container,
      questions: stub.questions,
      bus: stub.bus,
      tools: [noopTool],
      drainQueue: () => {
        seen.push(1);
        return stub.drainQueue();
      },
    });

    const copies = result.messages.filter((message) => message.content.includes('first')).length;
    assert.equal(copies, 1);
    assert.ok(seen.length >= 3, 'drained at each tool-call boundary');
  });

  it('announces the handover so the interface can clear its list', async () => {
    const stub = harness([['hurry up']]);
    let announced = 0;
    stub.bus.on('agent.dequeued', (event) => {
      announced += event.count;
    });

    await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([toolTurn('c1'), finalTurn]),
      container,
      questions: stub.questions,
      bus: stub.bus,
      tools: [noopTool],
      drainQueue: stub.drainQueue,
    });

    assert.equal(announced, 1);
  });

  it('changes nothing when nobody typed anything', async () => {
    const stub = harness([[]]);
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([toolTurn('c1'), finalTurn]),
      container,
      questions: stub.questions,
      bus: stub.bus,
      tools: [noopTool],
      drainQueue: stub.drainQueue,
    });

    const users = result.messages.filter((message) => message.role === 'user');
    assert.equal(users.length, 1);
  });

  it('works without a queue at all', async () => {
    // The option is optional, and every existing caller omits it.
    const bus = new EventBus();
    const result = await runLoop([{ role: 'user', content: 'go' }], {
      provider: scripted([toolTurn('c1'), finalTurn]),
      container,
      questions: new QuestionBroker(bus, 50),
      bus,
      tools: [noopTool],
    });
    assert.equal(result.stop, 'complete');
  });
});
