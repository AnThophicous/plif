import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import {
  ActionLoopDetector,
  DEFAULT_AGENT_EXECUTION_POLICY,
  ProgressWatchdog,
  SingleFlight,
  actionFingerprint,
  normalizeActionArguments,
} from '../src/harness/loop-safety.js';
import { runLoop } from '../src/harness/loop.js';
import type { Tool } from '../src/harness/tools.js';
import type { CompletionEvent, ModelProvider } from '../src/model/provider.js';

function providerFrom(
  next: (request: Parameters<ModelProvider['stream']>[0], call: number) => CompletionEvent[],
): ModelProvider {
  let calls = 0;
  return {
    info: { id: 'loop-safety-test', endpoint: 'test', contextWindow: 100_000 },
    async *stream(request) {
      calls += 1;
      for (const event of next(request, calls)) yield event;
    },
    async probe() { return { ok: true, detail: 'ok' }; },
    async list() { return []; },
  };
}

const updatePlan: Tool = {
  spec: { name: 'update_plan', description: 'update plan', parameters: {} },
  async run() { return { output: 'plan saved', ok: true }; },
};

const writeFile: Tool = {
  spec: { name: 'write_file', description: 'write file', parameters: {} },
  async run() { return { output: 'file changed', ok: true, diff: '--- a/file\n+++ b/file' }; },
};

function toolCall(id: string, name: string, arguments_: Record<string, unknown>): CompletionEvent {
  return { kind: 'tool', call: { id, name, arguments: JSON.stringify(arguments_) } };
}

describe('P0 loop safety primitives', () => {
  it('keeps a very large token ceiling while independent loop watchdogs remain active', () => {
    assert.equal(DEFAULT_AGENT_EXECUTION_POLICY.maxRunTokens, 10_000_000);
    assert.ok(DEFAULT_AGENT_EXECUTION_POLICY.maxIterationsWithoutProgress > 0);
    assert.ok(DEFAULT_AGENT_EXECUTION_POLICY.maxRepeatedActions > 0);
  });

  it('treats reasoning and token consumption as non-progress and escalates once', () => {
    const watchdog = new ProgressWatchdog({
      softTokensWithoutProgress: 10,
      hardTokensWithoutProgress: 100,
      maxIterationsWithoutProgress: 3,
      maxRecoveryAttempts: 1,
      maxRunTokens: 1_000,
    });

    watchdog.beginIteration();
    watchdog.recordTokens(10);
    assert.equal(watchdog.evaluate().kind, 'recover');
    watchdog.markRecoveryAttempt();
    watchdog.beginIteration();
    watchdog.recordTokens(10);

    const decision = watchdog.evaluate();
    assert.deepEqual(
      decision.kind === 'stop' ? decision.reason : undefined,
      'stagnation',
    );
    assert.equal(watchdog.snapshot().progressEpoch, 0);
    assert.equal(watchdog.snapshot().totalRunTokens, 20);
  });

  it('keeps productive work outside the stagnation budget', () => {
    const watchdog = new ProgressWatchdog({
      softTokensWithoutProgress: 5,
      hardTokensWithoutProgress: 10,
      maxIterationsWithoutProgress: 2,
      maxRunTokens: 50,
    });

    watchdog.beginIteration();
    watchdog.recordTokens(9);
    watchdog.markProgress();
    watchdog.beginIteration();
    watchdog.recordTokens(4);

    assert.equal(watchdog.evaluate().kind, 'allow');
    assert.equal(watchdog.snapshot().tokensSinceProgress, 4);
    assert.equal(watchdog.snapshot().progressEpoch, 1);
  });

  it('detects repeated actions and short alternating sequences', () => {
    const detector = new ActionLoopDetector({ maxRepeatedActions: 2, repeatedSequenceWindow: 6 });
    assert.equal(detector.observe('a').repeated, false);
    assert.equal(detector.observe('a').repeated, false);
    assert.equal(detector.observe('a').repeated, true);

    detector.reset();
    detector.observe('a');
    detector.observe('b');
    detector.observe('a');
    assert.equal(detector.observe('b').sequence, true);
  });

  it('fingerprints equivalent argument objects identically but separates state versions', () => {
    const first = normalizeActionArguments({ b: 2, a: { d: false, c: true } });
    const second = normalizeActionArguments({ a: { c: true, d: false }, b: 2 });
    assert.equal(first, second);
    assert.notEqual(actionFingerprint('write_file', first, 0), actionFingerprint('write_file', first, 1));
  });

  it('allows one owner and rejects a second owner until release', () => {
    const flight = new SingleFlight();
    const owner = flight.claim();
    assert.ok(owner);
    assert.equal(flight.claim(), null);
    flight.release(owner);
    assert.ok(flight.claim());
  });
});

describe('P0 loop safety integration', () => {
  it('stops a reasoning-only PLIF continuation after bounded recovery', async () => {
    let requests = 0;
    const provider = providerFrom((_request, call) => {
      requests = call;
      if (call === 1) return [toolCall('plan', 'update_plan', { plan: [{ step: 'change', status: 'in_progress' }] }), { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 1, completionTokens: 1 } }];
      if (call === 2) return [toolCall('write', 'write_file', { path: '/project/file.txt', content: 'changed' }), { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 1, completionTokens: 1 } }];
      return [{ kind: 'reasoning', delta: 'same internal thought' }, { kind: 'done', reason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } }];
    });

    const result = await runLoop([{ role: 'user', content: 'change the file' }], {
      provider,
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [updatePlan, writeFile],
      enableHarnessCycle: true,
      maxIterations: 20,
      executionPolicy: {
        softTokensWithoutProgress: 2,
        hardTokensWithoutProgress: 100,
        maxIterationsWithoutProgress: 2,
        maxRecoveryAttempts: 1,
        maxRunTokens: 100,
      },
    });

    assert.equal(result.stop, 'stagnation', result.error?.message);
    assert.ok(requests <= 5, `unbounded continuation made ${requests} provider calls`);
    assert.equal(result.progressEpoch, 3);
    assert.equal(result.stagnationState, 'hard_stop');
  });

  it('stops at the total run budget even when each pass produces a tool result', async () => {
    let requests = 0;
    const ping: Tool = {
      spec: { name: 'ping', description: 'ping', parameters: {} },
      async run() { return { output: 'pong', ok: true }; },
    };
    const provider = providerFrom((_request, call) => {
      requests = call;
      return [toolCall(`ping-${call}`, 'ping', { call }), { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 5, completionTokens: 5 } }];
    });

    const result = await runLoop([{ role: 'user', content: 'keep going' }], {
      provider,
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [ping],
      maxIterations: 20,
      executionPolicy: { maxRunTokens: 15, maxIterationsWithoutProgress: 10 },
    });

    assert.equal(result.stop, 'run_budget', result.error?.message);
    assert.equal(requests, 2);
    assert.ok(result.totalRunTokens >= 20);
  });

  it('rejects a duplicate continuation for the same logical turn', async () => {
    let signalStarted!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const provider: ModelProvider = {
      info: { id: 'single-flight-test', endpoint: 'test', contextWindow: 100_000 },
      async *stream() {
        signalStarted();
        await released;
        yield { kind: 'done', reason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } };
      },
      async probe() { return { ok: true, detail: 'ok' }; },
      async list() { return []; },
    };

    const first = runLoop([{ role: 'user', content: 'same turn' }], {
      provider,
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [],
      turnId: 'same-logical-turn',
    });
    await started;
    await assert.rejects(
      runLoop([{ role: 'user', content: 'same turn' }], {
        provider,
        container: {} as never,
        questions: {} as never,
        bus: new EventBus(),
        tools: [],
        turnId: 'same-logical-turn',
      }),
      /already active/,
    );
    releaseProvider();
    assert.equal((await first).stop, 'complete');
  });

  it('bounds provider retry events instead of waiting indefinitely', async () => {
    let requests = 0;
    const provider = providerFrom((_request, call) => {
      requests = call;
      return [
        { kind: 'retry', attempt: 1, of: 99, waitMs: 0, reason: 'transient test failure' },
        { kind: 'retry', attempt: 2, of: 99, waitMs: 0, reason: 'transient test failure' },
        { kind: 'retry', attempt: 3, of: 99, waitMs: 0, reason: 'transient test failure' },
      ];
    });

    const result = await runLoop([{ role: 'user', content: 'retry' }], {
      provider,
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [],
      maxIterations: 2,
      executionPolicy: { maxRetries: 2 },
    });

    assert.equal(result.stop, 'retry_limit', result.error?.message);
    assert.equal(requests, 1);
    assert.equal(result.retries, 3);
  });
});
