import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runBtw } from '../src/harness/btw.js';
import { collect } from '../src/model/provider.js';
import type {
  CompletionEvent,
  CompletionRequest,
  ModelProvider,
} from '../src/model/provider.js';

const usage = { promptTokens: 3, completionTokens: 2 };

function providerFrom(
  script: (request: CompletionRequest) => AsyncGenerator<CompletionEvent>,
): ModelProvider {
  return {
    info: { id: 'btw-test', endpoint: 'test://btw', contextWindow: 100_000 },
    stream(request) {
      return script(request);
    },
    async probe() { return { ok: true, detail: 'test' }; },
    async list() { return []; },
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

describe('ephemeral BTW core', () => {
  it('sends a copied, text-only read-only replay request without leaking secrets', async () => {
    const messages = [
      { role: 'user' as const, content: 'OPENAI_API_KEY=super-secret-key' },
      {
        role: 'tool' as const,
        content: 'DATABASE_URL=postgres://user:password@db.example.test/app',
        toolCallId: 'read-1',
      },
    ];
    const before = JSON.stringify(messages);
    let captured: CompletionRequest | undefined;
    const provider = providerFrom(async function* (request) {
      captured = request;
      yield { kind: 'text', delta: 'The value is super-secret-key.' };
      yield { kind: 'done', reason: 'stop', usage };
    });
    const parent = new AbortController();

    const result = await runBtw({
      provider,
      snapshot: { messages, context: 'PORT=4310\nAPP_TOKEN=another-secret-token' },
      question: 'What is the safe way to inspect this configuration?',
      signal: parent.signal,
      maxTokens: 128,
      maxContextTokens: 256,
      execution: { cwd: '/workspace', workspaceRoots: ['/workspace'] },
    });

    assert.equal(result.status, 'complete');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, usage);
    assert.ok(captured);
    assert.equal(captured.tools, undefined);
    assert.equal(captured.preloadedSkills, undefined);
    assert.equal(captured.conversationState, undefined);
    assert.equal(captured.conversationStateMode, 'replay');
    assert.notEqual(captured.signal, parent.signal);
    assert.ok(captured.signal);
    assert.equal(captured.execution?.permissionMode, 'deny');
    assert.equal(captured.execution?.ask, undefined);
    assert.equal(captured.execution?.approve, undefined);
    assert.equal(captured.execution?.cwd, '/workspace');
    assert.deepEqual(captured.execution?.workspaceRoots, ['/workspace']);
    assert.equal(captured.messages.length, 2);
    assert.match(captured.messages[0]!.content, /ephemeral|separate/i);
    assert.doesNotMatch(captured.messages[1]!.content, /super-secret-key/);
    assert.doesNotMatch(captured.messages[1]!.content, /another-secret-token/);
    assert.doesNotMatch(result.text, /super-secret-key/);
    assert.equal(JSON.stringify(messages), before, 'the primary snapshot must not be mutated');
    assert.equal(parent.signal.aborted, false, 'BTW must not abort the caller signal');
  });

  it('cancels only the side request and forwards cancellation to its private signal', async () => {
    let captured: CompletionRequest | undefined;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const provider = providerFrom(async function* (request) {
      captured = request;
      started();
      await waitForAbort(request.signal!);
      yield { kind: 'done', reason: 'cancelled', usage };
    });
    const parent = new AbortController();
    const pending = runBtw({
      provider,
      snapshot: { messages: [] },
      question: 'Can you answer this aside?',
      signal: parent.signal,
      timeoutMs: 2_000,
    });

    await startedPromise;
    parent.abort();
    const result = await pending;

    assert.equal(result.status, 'cancelled');
    assert.equal(result.finishReason, 'cancelled');
    assert.equal(captured?.signal?.aborted, true);
  });

  it('returns a timeout even when the provider only reacts after its signal is aborted', async () => {
    let captured: CompletionRequest | undefined;
    const provider = providerFrom(async function* (request) {
      captured = request;
      await waitForAbort(request.signal!);
      yield { kind: 'text', delta: 'late answer' };
      yield { kind: 'done', reason: 'stop', usage };
    });
    const parent = new AbortController();

    const result = await runBtw({
      provider,
      snapshot: { messages: [] },
      question: 'This should time out.',
      signal: parent.signal,
      timeoutMs: 5,
    });

    assert.equal(result.status, 'timeout');
    assert.equal(result.finishReason, 'timeout');
    assert.equal(captured?.signal?.aborted, true);
    assert.equal(parent.signal.aborted, false);
  });

  it('truncates the snapshot deterministically and reports that fact', async () => {
    let captured: CompletionRequest | undefined;
    const provider = providerFrom(async function* (request) {
      captured = request;
      yield { kind: 'text', delta: 'short answer' };
      yield { kind: 'done', reason: 'stop', usage };
    });
    const longMessage = [
      'first-anchor ',
      'x'.repeat(360),
      ' last-anchor',
    ].join('');

    const result = await runBtw({
      provider,
      snapshot: { messages: [{ role: 'user', content: longMessage }] },
      question: 'What is the relevant point?',
      maxContextTokens: 64,
    });

    assert.equal(result.status, 'complete');
    assert.equal(result.contextTruncated, true);
    assert.ok(captured);
    assert.match(captured.messages[1]!.content, /BTW context truncated/);
    assert.match(captured.messages[1]!.content, /first-anchor/);
    assert.match(captured.messages[1]!.content, /last-anchor/);
    assert.doesNotMatch(captured.messages[1]!.content, new RegExp(longMessage));
  });

  it('fails closed on tool activity instead of executing or returning a partial answer', async () => {
    const provider = providerFrom(async function* () {
      yield { kind: 'text', delta: 'before the forbidden tool' };
      yield {
        kind: 'tool_activity',
        activity: { id: 'tool-1', name: 'read_file', phase: 'start' },
      };
      yield { kind: 'done', reason: 'tool_calls', usage };
    });

    const result = await runBtw({
      provider,
      snapshot: { messages: [] },
      question: 'Do not use tools for this question.',
    });

    assert.equal(result.status, 'error');
    assert.equal(result.finishReason, 'error');
    assert.equal(result.text, '');
  });

  it('contains a provider failure so the primary provider call can continue', async () => {
    let calls = 0;
    const provider = providerFrom(async function* (request) {
      calls += 1;
      if (request.conversationStateMode === 'replay') {
        throw new Error('provider failed with OPENAI_API_KEY=do-not-return-this');
      }
      yield { kind: 'text', delta: 'primary call is still healthy' };
      yield { kind: 'done', reason: 'stop', usage };
    });

    const btw = await runBtw({
      provider,
      snapshot: { messages: [] },
      question: 'The side request is expected to fail.',
    });
    const primary = await collect(provider.stream({
      messages: [{ role: 'user', content: 'continue the main task' }],
    }));

    assert.equal(btw.status, 'error');
    assert.equal(btw.text, '');
    assert.equal(primary.text, 'primary call is still healthy');
    assert.equal(calls, 2);
  });
});

