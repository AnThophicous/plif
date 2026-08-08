import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { compact, estimateTokens, pinnedIndices } from '../src/harness/compaction.js';
import { MemoryStore, strategyId, summariseMemory } from '../src/harness/memory.js';
import { assess } from '../src/harness/learning.js';
import { StorePaths } from '../src/store/paths.js';
import type { Message } from '../src/model/provider.js';

describe('MemoryStore', () => {
  let root: string;
  let store: MemoryStore;
  const workspace = 'C:/proj/alpha';

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-mem-'));
    store = new MemoryStore(new StorePaths(root));
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('accumulates outcomes on one strategy rather than duplicating it', async () => {
    await store.recordOutcome({
      workspace,
      goal: 'node',
      approach: 'node test.js',
      ok: true,
      context: { os: 'win32' },
      sessionId: 's1',
    });
    await store.recordOutcome({
      workspace,
      goal: 'node',
      approach: 'node test.js',
      ok: true,
      context: { os: 'linux' },
      sessionId: 's2',
    });

    const strategies = await store.strategies(workspace);
    const target = strategies.find((s) => s.id === strategyId('node', 'node test.js'));

    assert.equal(strategies.length, 1);
    assert.equal(target?.outcomes.length, 2);
    assert.equal(assess(target!).confidence, 'provisional');
  });

  it('keeps one workspace memory out of another', async () => {
    await store.recordOutcome({
      workspace: 'C:/proj/beta',
      goal: 'make',
      approach: 'make build',
      ok: true,
      context: { os: 'win32' },
      sessionId: 's1',
    });

    assert.equal((await store.strategies(workspace)).length, 1);
    assert.equal((await store.strategies('C:/proj/beta')).length, 1);
  });

  it('counts a repeated fact as a confirmation instead of a duplicate', async () => {
    await store.remember({ workspace, kind: 'fact', text: 'tests run with node test.js' });
    const second = await store.remember({
      workspace,
      kind: 'fact',
      text: '  tests run with node test.js  ',
    });

    const facts = await store.facts(workspace);
    assert.equal(facts.length, 1);
    assert.equal(second.confirmations, 2);
  });

  it('drops a fact once it has been contradicted enough', async () => {
    const fact = await store.remember({ workspace, kind: 'fact', text: 'the build uses webpack' });
    await store.contradict(workspace, fact.id);
    assert.equal((await store.facts(workspace)).some((f) => f.id === fact.id), true);

    await store.contradict(workspace, fact.id);
    assert.equal((await store.facts(workspace)).some((f) => f.id === fact.id), false);
  });

  it('separates what is true from what does not work', async () => {
    await store.remember({ workspace, kind: 'failure', text: 'npm is not installed here' });
    const snapshot = await store.snapshot(workspace);

    assert.equal(snapshot.failures.length, 1);
    assert.equal(snapshot.facts.some((f) => f.kind === 'failure'), false);

    const summary = summariseMemory(snapshot);
    assert.match(summary, /Known about this project/);
    assert.match(summary, /Known not to work here/);
  });

  it('appends a note without repeating it', async () => {
    await store.appendNote(workspace, 'prefer pnpm here');
    await store.appendNote(workspace, 'prefer pnpm here');

    const notes = await store.notes(workspace);
    assert.equal(notes.split('prefer pnpm here').length - 1, 1);
  });
});

describe('compaction', () => {
  const system: Message = { role: 'system', content: 'you are plif' };
  const task: Message = { role: 'user', content: 'fix the failing test' };

  function conversation(pairs: number, filler = 400): Message[] {
    const messages: Message[] = [system, task];
    for (let index = 0; index < pairs; index += 1) {
      messages.push({
        role: 'assistant',
        content: '',
        reasoning: 'x'.repeat(filler),
        toolCalls: [
          { id: `call_${index}`, name: 'read_file', arguments: `{"path":"/workspace/f${index}.ts"}` },
        ],
      });
      messages.push({ role: 'tool', content: 'y'.repeat(filler), toolCallId: `call_${index}` });
    }
    return messages;
  }

  it('leaves a conversation alone when it fits', async () => {
    const messages = conversation(2);
    const result = await compact(messages, { maxTokens: 1_000_000 });

    assert.equal(result.messages.length, messages.length);
    assert.equal(result.stages.length, 0);
    assert.equal(result.after, result.before);
  });

  it('never drops the system prompt or the original task', async () => {
    const messages = conversation(30);
    const result = await compact(messages, { maxTokens: 500 });

    assert.equal(result.messages[0]?.role, 'system');
    assert.equal(
      result.messages.some((m) => m.role === 'user' && m.content === 'fix the failing test'),
      true,
    );
  });

  it('keeps the most recent turns verbatim', async () => {
    const messages = conversation(20);
    const result = await compact(messages, { maxTokens: 500, keepRecent: 4 });
    const tail = messages.slice(-4);

    for (const message of tail) {
      assert.equal(
        result.messages.some((m) => m.content === message.content),
        true,
        'a recent message was altered',
      );
    }
  });

  it('shrinks the estimate it was asked to shrink', async () => {
    const messages = conversation(30);
    const result = await compact(messages, { maxTokens: 800 });

    assert.ok(result.after < result.before, `${result.after} not below ${result.before}`);
    assert.ok(result.stages.length > 0);
  });

  it('collapses a superseded read of the same path', async () => {
    const messages: Message[] = [
      system,
      task,
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'a', name: 'read_file', arguments: '{"path":"/workspace/x.ts"}' }],
      },
      { role: 'tool', content: 'z'.repeat(5000), toolCallId: 'a' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'b', name: 'read_file', arguments: '{"path":"/workspace/x.ts"}' }],
      },
      { role: 'tool', content: 'z'.repeat(5000), toolCallId: 'b' },
      { role: 'user', content: 'carry on' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'and again' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'once more' },
      { role: 'assistant', content: 'ok' },
    ];

    const result = await compact(messages, { maxTokens: 900, keepRecent: 4 });
    const stale = result.messages.find((m) => m.toolCallId === 'a');

    assert.match(stale?.content ?? '', /superseded/);
  });

  it('pins the system prompt, the first task and the recent tail', () => {
    const messages = conversation(10);
    const pinned = pinnedIndices(messages, 4);

    assert.equal(pinned.has(0), true);
    assert.equal(pinned.has(1), true);
    assert.equal(pinned.has(messages.length - 1), true);
    assert.equal(pinned.has(6), false);
  });

  it('estimates tokens from every field that goes on the wire', () => {
    const bare = estimateTokens([{ role: 'user', content: 'hello' }]);
    const withReasoning = estimateTokens([
      { role: 'user', content: 'hello', reasoning: 'x'.repeat(400) },
    ]);
    const withTools = estimateTokens([
      {
        role: 'assistant',
        content: 'hello',
        toolCalls: [{ id: 'a', name: 'run_command', arguments: '{"argv":["npm","test"]}' }],
      },
    ]);

    assert.ok(withReasoning > bare);
    assert.ok(withTools > bare);
  });
});
