import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { ConversationState } from '../src/model/conversation-state.js';
import type { ConversationEvent } from '../src/session/events.js';
import { SessionStore, workspaceKey } from '../src/session/store.js';
import { StorePaths } from '../src/store/paths.js';

const roots: string[] = [];
const at = '2026-08-27T12:00:00.000Z';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function state(generation: number): ConversationState {
  return {
    version: 1,
    scope: {
      providerId: 'test',
      model: 'test-model',
      endpoint: 'test://endpoint',
    },
    mode: 'native',
    kind: 'responses-previous-id',
    previousResponseId: `response-${generation}`,
    generation,
    updatedAt: at,
  };
}

describe('SessionStore per-session atomic writes', () => {
  it('keeps metadata and transcript consistent across separate session handles', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-session-lock-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const firstStore = new SessionStore(new StorePaths(root));
    const first = await firstStore.create(workspace);
    const secondStore = new SessionStore(new StorePaths(root));
    const second = await secondStore.resolve(workspace, first.id);
    assert.ok(second);

    await Promise.all([
      first.append({
        version: 1,
        eventId: 'first-message',
        turnId: 'first-turn',
        at,
        kind: 'user.message',
        text: 'first message',
      } satisfies ConversationEvent),
      second.append({
        version: 1,
        eventId: 'second-message',
        turnId: 'second-turn',
        at,
        kind: 'user.message',
        text: 'second message',
      } satisfies ConversationEvent),
    ]);

    const listed = await firstStore.list(workspace);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.turns, 2);
    assert.equal((await first.history()).filter((event) => event.kind === 'user.message').length, 2);

    const sessionDir = path.join(root, 'sessions', workspaceKey(workspace));
    const files = await fs.readdir(sessionDir);
    assert.equal(files.some((file) => file.endsWith('.tmp')), false);
    assert.equal(JSON.parse(await fs.readFile(path.join(sessionDir, `${first.id}.json`), 'utf8')).turns, 2);
  });

  it('checks conversation generations while holding the session lock', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-state-lock-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const firstStore = new SessionStore(new StorePaths(root));
    const first = await firstStore.create(workspace);
    const secondStore = new SessionStore(new StorePaths(root));
    const second = await secondStore.resolve(workspace, first.id);
    assert.ok(second);

    // The older write is intentionally scheduled after the newer one. It must
    // observe generation 9 under the lock and decline to replace it.
    await Promise.all([
      secondStore.saveConversationState(second.meta, state(9)),
      firstStore.saveConversationState(first.meta, state(3)),
    ]);
    assert.equal((await firstStore.loadConversationState(first.meta))?.generation, 9);

    const sessionDir = path.join(root, 'sessions', workspaceKey(workspace));
    const files = await fs.readdir(sessionDir);
    assert.equal(files.some((file) => file.endsWith('.tmp')), false);
  });

  it('delivers each queued input exactly once while appending its history event', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-queued-input-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const store = new SessionStore(new StorePaths(root));
    const session = await store.create(workspace);
    await session.enqueueInput('follow-up from the parent');
    assert.equal((await session.history()).filter((item) => item.kind === 'queued.input').length, 1);
    const [input] = await session.pendingInputs();
    assert.ok(input);

    const event = {
      version: 1,
      eventId: 'queued-user-event',
      turnId: 'queued-turn',
      at,
      kind: 'user.message',
      text: input.text,
    } satisfies ConversationEvent;

    assert.equal(await session.deliverInput(input.id, event), true);
    assert.equal(await session.deliverInput(input.id, event), false);
    assert.deepEqual(await session.pendingInputs(), []);
    assert.equal((await session.history()).filter((item) => item.eventId === event.eventId).length, 1);
  });
});
