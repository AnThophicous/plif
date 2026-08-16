import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { discoverProviderModels, forgetDiscoveredModels } from '../src/model/discovery.js';
import type { StoredConfig } from '../src/model/config.js';

async function modelServer(ids: readonly string[]): Promise<{
  readonly baseURL: string;
  close(): Promise<void>;
}> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: ids.map((id) => ({ id, object: 'model' })) }));
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
});
