import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { ConversationEvent } from '../src/session/events.js';
import { SessionStore, workspaceKey } from '../src/session/store.js';
import { StorePaths } from '../src/store/paths.js';

const roots: string[] = [];
const at = '2026-08-11T12:00:00.000Z';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  root: string;
  workspace: string;
  store: SessionStore;
  session: Awaited<ReturnType<SessionStore['create']>>;
  transcript: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-session-events-'));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  const store = new SessionStore(new StorePaths(root));
  const session = await store.create(workspace);
  const transcript = path.join(root, 'sessions', workspaceKey(workspace), `${session.id}.jsonl`);
  return { root, workspace, store, session, transcript };
}

describe('versioned session event storage', () => {
  it('writes canonical JSONL even through the legacy append API', async () => {
    const { session, transcript } = await fixture();
    await session.append({ kind: 'user', at, text: 'faça' });
    await session.append({ kind: 'assistant', at, text: 'feito' });

    const lines = (await fs.readFile(transcript, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.kind), ['user.message', 'assistant.message']);
    assert.equal(lines.every((line) => line.version === 1), true);
    assert.equal(lines[0]?.turnId, lines[1]?.turnId);
  });

  it('reads legacy and v1 lines and ignores a truncated final line', async () => {
    const { session, transcript } = await fixture();
    await fs.writeFile(transcript, [
      JSON.stringify({ kind: 'assistant', at, text: 'feito' }),
      JSON.stringify({
        version: 1,
        eventId: 'u1',
        turnId: 't1',
        at: '2026-08-11T12:00:01.000Z',
        kind: 'user.message',
        text: 'continue',
      }),
      '{"version":1,"eventId":',
    ].join('\n'), 'utf8');

    const replay = await session.replay();
    assert.deepEqual(replay.map((event) => event.kind), ['assistant.message', 'user.message']);
    assert.equal(new Set(replay.map((event) => event.eventId)).size, 2);
  });

  it('turns a malformed middle line into one bounded warning and keeps reading', async () => {
    const { session, transcript } = await fixture();
    const valid: ConversationEvent = {
      version: 1,
      eventId: 'u1',
      turnId: 't1',
      at,
      kind: 'user.message',
      text: 'after corruption',
    };
    await fs.writeFile(transcript, [
      JSON.stringify({ kind: 'user', at, text: 'before corruption' }),
      '{not json}',
      JSON.stringify(valid),
    ].join('\n') + '\n', 'utf8');

    const replay = await session.replay();
    assert.deepEqual(replay.map((event) => event.kind), [
      'user.message',
      'notice.recorded',
      'user.message',
    ]);
    const warning = replay[1];
    assert.equal(warning?.kind === 'notice.recorded' ? warning.level : null, 'warn');
    assert.match(warning?.kind === 'notice.recorded' ? warning.text : '', /line 2/);
  });

  it('deduplicates canonical event ids during replay', async () => {
    const { session, transcript } = await fixture();
    const event: ConversationEvent = {
      version: 1, eventId: 'same', turnId: 't', at, kind: 'user.message', text: 'oi',
    };
    await fs.writeFile(transcript, `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`, 'utf8');

    assert.equal((await session.replay()).length, 1);
  });

  it('keeps the complete human history separate from compact model replay', async () => {
    const { session, transcript } = await fixture();
    const events: ConversationEvent[] = [
      { version: 1, eventId: 'old-user', turnId: 'old-turn', at, kind: 'user.message', text: 'older question' },
      { version: 1, eventId: 'old-answer', turnId: 'old-turn', at, kind: 'assistant.message', phase: 'final', text: 'older answer' },
      { version: 1, eventId: 'compact', turnId: 'old-turn', at, kind: 'compaction.completed', summary: 'older answer', replacedEvents: 2 },
      { version: 1, eventId: 'new-user', turnId: 'new-turn', at, kind: 'user.message', text: 'new question' },
    ];
    await fs.writeFile(transcript, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');

    assert.deepEqual((await session.history()).map((event) => event.eventId), ['old-user', 'old-answer', 'compact', 'new-user']);
    assert.deepEqual((await session.replay()).map((event) => event.eventId), ['compact', 'new-user']);
  });

  it('renames metadata without rewriting the append-only transcript', async () => {
    const { session, store, workspace, transcript } = await fixture();
    await session.append({ kind: 'user', at, text: 'original prompt' });
    const before = await fs.readFile(transcript, 'utf8');

    await session.rename('Raw input investigation');

    assert.equal(session.meta.title, 'Raw input investigation');
    assert.equal((await store.list(workspace))[0]?.title, 'Raw input investigation');
    assert.equal(await fs.readFile(transcript, 'utf8'), before);
  });
});
