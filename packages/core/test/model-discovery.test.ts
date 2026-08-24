import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { discoverProviderModels, forgetDiscoveredModels } from '../src/model/discovery.js';
import type { StoredConfig } from '../src/model/config.js';

async function modelServer(
  ids: readonly string[],
  options: {
    readonly delayMs?: number;
    readonly count?: { value: number };
    readonly idsRef?: { value: readonly string[] };
    readonly status?: number;
    readonly byKey?: Readonly<Record<string, readonly string[]>>;
  } = {},
): Promise<{
  readonly baseURL: string;
  close(): Promise<void>;
}> {
  const server = http.createServer(async (request, response) => {
    if (options.count) options.count.value += 1;
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    const key = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const current = options.byKey?.[key] ?? options.idsRef?.value ?? ids;
    response.writeHead(options.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: current.map((id) => ({ id, object: 'model' })) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function metadataServer(): Promise<{
  readonly baseURL: string;
  close(): Promise<void>;
}> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{
      id: 'rich-model',
      object: 'model',
      name: 'DeepSeek R1',
      aliases: ['r1', 'reasoner'],
      ranking: { quality: 88, reasoning: 97, coding: 91 },
      context_window: 131072,
      provider: 'opencode-go',
      tier: 'go',
      cost: 'paid',
    }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function stored(baseURL: string): StoredConfig {
  return {
    model: 'bridge/current',
    provider: {
      bridge: {
        options: { baseURL, needKey: false },
        models: { current: {} },
      },
    },
  };
}

describe('provider model discovery cache', () => {
  it('separates the same provider id by effective endpoint', async () => {
    const first = await modelServer(['first-model']);
    const second = await modelServer(['second-model']);
    forgetDiscoveredModels();
    try {
      const left = await discoverProviderModels('bridge', { stored: stored(first.baseURL) });
      const right = await discoverProviderModels('bridge', { stored: stored(second.baseURL) });
      assert.deepEqual(left.ids, ['first-model']);
      assert.deepEqual(right.ids, ['second-model']);
    } finally {
      forgetDiscoveredModels();
      await Promise.all([first.close(), second.close()]);
    }
  });

  it('treats an explicit empty provider response as authoritative', async () => {
    const server = await modelServer([]);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-cache-'));
    try {
      forgetDiscoveredModels();
      const result = await discoverProviderModels('bridge', {
        stored: stored(server.baseURL),
        cacheFile: path.join(root, 'models.json'),
      });
      assert.equal(result.live, true);
      assert.equal(result.source, 'live');
      assert.deepEqual(result.ids, []);
    } finally {
      forgetDiscoveredModels();
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('accepts provider identifier changes without retaining the retired id', async () => {
    const ids = { value: ['deepseek-v4-flash'] as readonly string[] };
    const server = await modelServer(ids.value, { idsRef: ids });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-cache-'));
    try {
      forgetDiscoveredModels();
      const cacheFile = path.join(root, 'models.json');
      const before = await discoverProviderModels('bridge', { stored: stored(server.baseURL), cacheFile });
      assert.deepEqual(before.ids, ['deepseek-v4-flash']);
      ids.value = ['deepseek-v4-flash-8301'];
      const after = await discoverProviderModels('bridge', { stored: stored(server.baseURL), cacheFile, refresh: true });
      assert.deepEqual(after.ids, ['deepseek-v4-flash-8301']);
    } finally {
      forgetDiscoveredModels();
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('deduplicates concurrent refreshes and keeps metadata from the endpoint', async () => {
    const count = { value: 0 };
    const server = await modelServer(['rich-model'], { delayMs: 35, count });
    const metadata = await metadataServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-cache-'));
    try {
      forgetDiscoveredModels();
      const cacheFile = path.join(root, 'models.json');
      const results = await Promise.all([
        discoverProviderModels('bridge', { stored: stored(server.baseURL), cacheFile, refresh: true }),
        discoverProviderModels('bridge', { stored: stored(server.baseURL), cacheFile, refresh: true }),
        discoverProviderModels('bridge', { stored: stored(server.baseURL), cacheFile, refresh: true }),
      ]);
      assert.equal(count.value, 1);
      assert.deepEqual(results[0]?.ids, ['rich-model']);

      forgetDiscoveredModels();
      const rich = await discoverProviderModels('bridge', {
        stored: stored(metadata.baseURL),
        cacheFile,
      });
      assert.equal(rich.models[0]?.contextWindow, 131072);
      assert.equal(rich.models[0]?.cost, 'paid');
      assert.equal(rich.models[0]?.provider, 'opencode-go');
      assert.equal(rich.models[0]?.tier, 'go');
      assert.deepEqual(rich.models[0]?.aliases, ['r1', 'reasoner']);
      assert.equal(rich.models[0]?.ranking?.reasoning, 97);
    } finally {
      forgetDiscoveredModels();
      await Promise.all([server.close(), metadata.close()]);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('serves last-known-good models when the provider is temporarily unavailable', async () => {
    const server = await modelServer(['cached-model']);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-cache-'));
    const cacheFile = path.join(root, 'models.json');
    try {
      forgetDiscoveredModels();
      const live = await discoverProviderModels('bridge', { stored: stored(server.baseURL), cacheFile });
      assert.deepEqual(live.ids, ['cached-model']);
      await server.close();

      forgetDiscoveredModels();
      const stale = await discoverProviderModels('bridge', {
        stored: stored(server.baseURL),
        cacheFile,
        refresh: true,
      });
      assert.deepEqual(stale.ids, ['cached-model']);
      assert.equal(stale.stale, true);
      assert.equal(stale.error, 'unavailable');
    } finally {
      forgetDiscoveredModels();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('never writes the API key into the persistent model cache', async () => {
    const server = await modelServer(['private-model']);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-cache-'));
    const cacheFile = path.join(root, 'models.json');
    try {
      forgetDiscoveredModels();
      await discoverProviderModels('bridge', {
        stored: stored(server.baseURL),
        apiKey: 'super-secret-provider-key',
        cacheFile,
      });
      const raw = await fs.readFile(cacheFile, 'utf8');
      assert.doesNotMatch(raw, /super-secret-provider-key/);
      assert.match(raw, /bridge/);
    } finally {
      forgetDiscoveredModels();
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps credential-specific discovery isolated for one endpoint', async () => {
    const server = await modelServer([], {
      byKey: {
        alpha: ['alpha-model'],
        beta: ['beta-model'],
      },
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-cache-'));
    try {
      forgetDiscoveredModels();
      const cacheFile = path.join(root, 'models.json');
      const alpha = await discoverProviderModels('bridge', { stored: stored(server.baseURL), apiKey: 'alpha', cacheFile });
      const beta = await discoverProviderModels('bridge', { stored: stored(server.baseURL), apiKey: 'beta', cacheFile });
      assert.deepEqual(alpha.ids, ['alpha-model']);
      assert.deepEqual(beta.ids, ['beta-model']);
    } finally {
      forgetDiscoveredModels();
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('backs off a rate-limited provider instead of retrying on every picker open', async () => {
    const count = { value: 0 };
    const server = await modelServer([], { count, status: 429 });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-cache-'));
    try {
      forgetDiscoveredModels();
      const cacheFile = path.join(root, 'models.json');
      const first = await discoverProviderModels('bridge', { stored: stored(server.baseURL), cacheFile });
      assert.equal(first.error, 'rate_limit');
      const second = await discoverProviderModels('bridge', {
        stored: stored(server.baseURL),
        cacheFile,
        waitForNetwork: false,
      });
      assert.equal(second.source, 'fallback');
      assert.equal(count.value, 1);
    } finally {
      forgetDiscoveredModels();
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
