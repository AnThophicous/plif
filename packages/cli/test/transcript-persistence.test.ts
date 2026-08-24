import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { SessionStore, StorePaths } from '@plif/core';
import type { ConversationEvent, Session } from '@plif/core';
import { TranscriptPersistenceQueue } from '../src/transcript/persistence.js';

const at = '2026-08-22T12:00:00.000Z';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function assistant(eventId: string, text: string): ConversationEvent {
  return {
    version: 1,
    eventId,
    turnId: 'turn-1',
    at,
    kind: 'assistant.message',
    text,
    phase: 'final',
  };
}

function sessionOf(
  append: (event: ConversationEvent) => Promise<void>,
): Session {
  return { append } as unknown as Session;
}

describe('transcript persistence ordering', () => {
  it('waits for an immediate fast-model final response before flush resolves', async () => {
    const events: ConversationEvent[] = [];
    const session = sessionOf(async (event) => {
      events.push(event);
    });
    const queue = new TranscriptPersistenceQueue({
      initialSession: session,
      createSession: async () => session,
      onSession: () => undefined,
      onFailure: (error) => { throw error; },
    });

    const text = 'token '.repeat(100).trim();
    await queue.enqueue(assistant('assistant-fast', text));
    await queue.flush();

    assert.equal(events[0]?.kind, 'assistant.message');
    assert.equal(events[0]?.text, text);
  });

  it('preserves slow-model event order and waits for the last append', async () => {
    const events: ConversationEvent[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const session = sessionOf(async (event) => {
      events.push(event);
      if (event.eventId === 'assistant-slow') await gate;
    });
    const queue = new TranscriptPersistenceQueue({
      initialSession: session,
      createSession: async () => session,
      onSession: () => undefined,
      onFailure: (error) => { throw error; },
    });

    let flushed = false;
    void queue.enqueue(assistant('assistant-slow', 'slow complete'));
    void queue.enqueue(assistant('turn-end', ''));
    const pending = queue.flush().then(() => { flushed = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(flushed, false);
    assert.deepEqual(events.map((event) => event.eventId), ['assistant-slow']);

    release();
    await pending;
    assert.equal(flushed, true);
    assert.deepEqual(events.map((event) => event.eventId), ['assistant-slow', 'turn-end']);
  });

  it('does not invent a persisted assistant message for an empty response', async () => {
    const events: ConversationEvent[] = [];
    const session = sessionOf(async (event) => { events.push(event); });
    const queue = new TranscriptPersistenceQueue({
      initialSession: session,
      createSession: async () => session,
      onSession: () => undefined,
      onFailure: (error) => { throw error; },
    });

    await queue.flush();
    assert.deepEqual(events, []);
  });

  it('keeps the generated output available when persistence fails', async () => {
    let failure: unknown = null;
    const queue = new TranscriptPersistenceQueue({
      initialSession: sessionOf(async () => {
        throw new Error('disk full');
      }),
      createSession: async () => { throw new Error('not used'); },
      onSession: () => undefined,
      onFailure: (error) => { failure = error; },
    });

    await queue.enqueue(assistant('assistant-recover', 'generated output'));
    await queue.flush();

    assert.equal((failure as Error).message, 'disk full');
  });

  it('survives a session reload after the final assistant commit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-transcript-queue-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const store = new SessionStore(new StorePaths(root));
    const session = await store.create(workspace);
    const queue = new TranscriptPersistenceQueue({
      initialSession: session,
      createSession: async () => session,
      onSession: () => undefined,
      onFailure: (error) => { throw error; },
    });

    await queue.enqueue(assistant('assistant-reload', 'response survives reload'));
    await queue.flush();

    const reopened = await store.resolve(workspace, session.id);
    assert.ok(reopened);
    const replay = await reopened.replay();
    assert.equal(replay.find((event) => event.eventId === 'assistant-reload')?.text, 'response survives reload');
  });
});
