import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OpenAIOAuthClient } from '../src/auth/openai-oauth.js';

function memoryStore(): { store: never; seen: () => Record<string, unknown> | undefined } {
  let saved: Record<string, unknown> | undefined;
  return {
    store: {
      async load() { return saved; },
      async save(_key: string, value: Record<string, unknown>) { saved = value; },
      async clear() { saved = undefined; },
    } as never,
    seen: () => saved,
  };
}

describe('OpenAI OAuth token storage', () => {
  it('keeps the expiry across a save and load, so a fresh token is not refreshed at once', async () => {
    const { store } = memoryStore();
    const client = new OpenAIOAuthClient(store, 'test');
    const expires = Date.now() + 3_600_000;

    await client.save({ access: 'a', refresh: 'r', expires, accountId: 'acct' });
    const loaded = await client.load();

    // The bug this pins: `expires` was written as a duration and read as an
    // absolute deadline, so every load looked expired and every request spent a
    // refresh — which is what made a just-completed login fail on its first
    // message.
    assert.equal(loaded?.expires, expires);
    assert.ok((loaded?.expires ?? 0) > Date.now() + 30_000, 'a fresh token must not read as due');
    assert.equal(loaded?.access, 'a');
    assert.equal(loaded?.refresh, 'r');
    assert.equal(loaded?.accountId, 'acct');
  });

  it('treats a token stored without an absolute expiry as due rather than guessing', async () => {
    let saved: Record<string, unknown> | undefined = {
      tokens: { access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 3600 },
    };
    const store = {
      async load() { return saved; },
      async save(_key: string, value: Record<string, unknown>) { saved = value; },
      async clear() { saved = undefined; },
    } as never;

    const loaded = await new OpenAIOAuthClient(store, 'test').load();
    assert.equal(loaded?.expires, 0);
  });

  it('frees the callback port when the browser flow fails', async () => {
    const { store } = memoryStore();
    const client = new OpenAIOAuthClient(store, 'test');

    // No browser is opened, so nothing ever calls back and the attempt times out.
    // The point is what happens afterwards: a second attempt must fail on the
    // same timeout, not on a port the first attempt never released.
    await assert.rejects(client.startBrowserLogin(async () => undefined, 150), /timed out/);
    await assert.rejects(client.startBrowserLogin(async () => undefined, 150), /timed out/);
  });
});
