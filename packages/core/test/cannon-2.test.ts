import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import { GoalController } from '../src/harness/goals.js';
import { runLoop } from '../src/harness/loop.js';
import { sessionSearch } from '../src/harness/tools.js';
import { sendMessageTool, SubagentCoordinator, subagentTool } from '../src/harness/subagent.js';
import type { ToolContext } from '../src/harness/tools.js';
import type { CompletionEvent, ModelProvider } from '../src/model/provider.js';
import { SessionStore } from '../src/session/store.js';
import { StorePaths } from '../src/store/paths.js';
import { DEFAULT_CAPABILITIES } from '../src/types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function provider(
  stream: (request: Parameters<ModelProvider['stream']>[0], call: number) => readonly CompletionEvent[],
): ModelProvider {
  let calls = 0;
  return {
    info: { id: 'cannon-2-test', endpoint: 'test', contextWindow: 100_000 },
    async *stream(request) {
      calls += 1;
      for (const event of stream(request, calls)) yield event;
    },
    async probe() { return { ok: true, detail: 'ok' }; },
    async list() { return []; },
  };
}

function testContext(extra: Partial<ToolContext> = {}): ToolContext {
  return {
    container: {
      name: 'test-container',
      workdir: '/workspace',
      capabilities: DEFAULT_CAPABILITIES,
      authorizeModel: async () => undefined,
    },
    questions: {} as ToolContext['questions'],
    signal: undefined,
    bus: new EventBus(),
    workspace: '/workspace',
    ...extra,
  } as ToolContext;
}

describe('Canhão 2.0 runtime features', () => {
  it('runs a script in one model turn, preserves order, and records one tool event', async () => {
    let requests = 0;
    const order: string[] = [];
    const events: string[] = [];
    const bus = new EventBus();
    bus.on('conversation.event', (event) => {
      if (event.kind === 'tool.completed') events.push(event.callId);
    });
    const tools = [
      {
        spec: { name: 'first', description: 'first', parameters: {} },
        async run() { order.push('first'); return { output: 'first output', ok: true }; },
      },
      {
        spec: { name: 'second', description: 'second', parameters: {} },
        async run() { order.push('second'); return { output: 'second output', ok: true }; },
      },
    ];
    const fake = provider((_request, call) => {
      requests = call;
      return call === 1
        ? [
            { kind: 'tool', call: {
              id: 'script-call',
              name: 'run_script',
              arguments: JSON.stringify({ steps: [
                { tool: 'first', args: {} },
                { tool: 'second', args: {} },
                { tool: 'first', args: {} },
              ] }),
            } },
            { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 1, completionTokens: 1 } },
          ]
        : [
            { kind: 'text', delta: 'finished' },
            { kind: 'done', reason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
          ];
    });

    const result = await runLoop([{ role: 'user', content: 'batch' }], {
      provider: fake,
      container: {} as never,
      questions: {} as never,
      bus,
      tools,
      maxIterations: 2,
    });

    assert.equal(result.stop, 'complete');
    assert.equal(requests, 2, 'the script must not create one request per step');
    assert.equal(result.toolCalls, 3);
    assert.deepEqual(order, ['first', 'second', 'first']);
    assert.deepEqual(events, ['script-call']);
  });

  it('fails fast with the failing step and previous step output', async () => {
    let followUp = '';
    const fake = provider((request, call) => {
      if (call === 2) followUp = request.messages.at(-1)?.content ?? '';
      return call === 1
        ? [
            { kind: 'tool', call: {
              id: 'failed-script',
              name: 'run_script',
              arguments: JSON.stringify({ steps: [
                { tool: 'ok_step', args: {} },
                { tool: 'bad_step', args: {} },
              ] }),
            } },
            { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 1, completionTokens: 1 } },
          ]
        : [
            { kind: 'text', delta: 'recovered' },
            { kind: 'done', reason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
          ];
    });
    const result = await runLoop([{ role: 'user', content: 'fail fast' }], {
      provider: fake,
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [
        { spec: { name: 'ok_step', description: 'ok', parameters: {} }, async run() {
          return { output: 'previous output', ok: true };
        } },
        { spec: { name: 'bad_step', description: 'bad', parameters: {} }, async run() {
          return { output: 'localized failure', ok: false };
        } },
      ],
      maxIterations: 2,
    });

    assert.equal(result.stop, 'complete');
    assert.match(followUp, /step 1: ok_step: previous output/);
    assert.match(followUp, /step 2: bad_step FAILED: localized failure/);
  });

  it('keeps model goals unarmed and enforces durable CAS plus blocker streak', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-goal-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const goal = new GoalController(root, workspace);

    const modelGoal = await goal.setModelGoal('inspect the project');
    assert.equal(modelGoal.armed, false);
    const userGoal = await goal.setUserGoal('fix the project');
    assert.equal(userGoal.armed, true);
    await assert.rejects(goal.complete(userGoal.revision - 1, 'wrong revision'), /revision conflict/);

    await goal.startRound();
    await goal.startRound();
    await goal.startRound();
    await assert.rejects(goal.block(goal.get()!.revision, 'provider unavailable'), /3 rounds/);
    await goal.startRound();
    await assert.rejects(goal.block(goal.get()!.revision, 'provider unavailable'), /3 rounds/);
    await goal.startRound();
    const blocked = await goal.block(goal.get()!.revision, 'provider unavailable');
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blockStreak, 3);

    const reloaded = new GoalController(root, workspace);
    await reloaded.ready();
    assert.equal(reloaded.get()?.status, 'blocked');
    assert.equal(reloaded.get()?.rounds, 5);

    const completed = await goal.setUserGoal('completed objective');
    await goal.complete(completed.revision, 'verified in the regression test');
    const reset = await goal.setUserGoal('new objective');
    assert.equal(reset.evidence, undefined, 'a new goal must not inherit old completion evidence');
  });

  it('searches only recent workspace sessions without mutating transcripts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-search-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const store = new SessionStore(new StorePaths(root));
    const older = await store.create(workspace);
    await older.append({ kind: 'user', at: '2026-08-01T00:00:00.000Z', text: 'build failed once' });
    await older.append({ kind: 'assistant', at: '2026-08-01T00:00:01.000Z', text: 'build failed; use npm run typecheck' });
    const newer = await store.create(workspace);
    await newer.append({ kind: 'user', at: '2026-08-02T00:00:00.000Z', text: 'build is green now' });
    const before = await newer.history();

    const result = await sessionSearch.run(
      { query: 'build', limit: 5 },
      testContext({ sessions: store, workspace }),
    );
    assert.equal(result.ok, true);
    assert.ok(result.output.length <= 5_000);
    const hits = JSON.parse(result.output) as Array<{ sessionId: string; excerpts: string[] }>;
    assert.equal(hits[0]?.sessionId, older.id, 'occurrences should outrank recency');
    assert.ok(hits[0]?.excerpts.some((excerpt) => /build/i.test(excerpt)));
    assert.deepEqual(await newer.history(), before);
  });

  it('continues a persisted subagent in the same child transcript', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-subagent-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const sessions = new SessionStore(new StorePaths(root));
    const coordinator = new SubagentCoordinator();
    const childProvider = provider((request) => {
      const last = request.messages.at(-1)?.content ?? '';
      return [
        { kind: 'text', delta: last.includes('follow up') ? 'continued answer' : 'initial answer' },
        { kind: 'done', reason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
      ];
    });
    const options = {
      provider: childProvider,
      isolation: 'test',
      stored: { model: 'parent-model' },
      coordinator,
      sessions,
      continuable: true,
      maxIterations: 2,
      createProvider: () => childProvider,
    };
    const context = testContext({ sessions, workspace });
    const spawn = subagentTool(options);
    const first = await spawn.run({ title: 'trace', task: 'inspect the issue' }, context);
    assert.equal(first.ok, true);
    const id = first.output.match(/\[subagent_id: (subagent:[^\]]+)\]/)?.[1];
    assert.ok(id);

    // Use a fresh coordinator to exercise the cold-resume manifest path rather
    // than the in-memory live-record shortcut.
    const coldOptions = { ...options, coordinator: new SubagentCoordinator() };
    const follow = await sendMessageTool(coldOptions).run({ subagent_id: id, message: 'follow up' }, context);
    assert.equal(follow.ok, true);
    assert.match(follow.output, /continued answer/);
    const sessionId = id!.slice('subagent:'.length);
    const child = await sessions.resolve(workspace, sessionId);
    assert.ok(child);
    const history = await child!.history();
    assert.deepEqual(history.filter((event) => event.kind === 'user.message').map((event) => event.text), [
      'inspect the issue',
      'follow up',
    ]);
    assert.ok(history.some((event) => event.kind === 'assistant.message' && event.text.includes('initial answer')));
    assert.ok(history.some((event) => event.kind === 'assistant.message' && event.text.includes('continued answer')));
    assert.equal((await sessions.list(workspace)).find((item) => item.id === sessionId)?.title, 'sub: trace');
  });
});
