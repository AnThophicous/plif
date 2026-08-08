import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import { McpOAuthCoordinator, type McpAuthEvent } from '../src/auth/mcp-oauth.js';
import {
  MemoryMcpOAuthStore,
  WindowsDpapiOAuthStore,
  mcpOAuthKey,
} from '../src/auth/store.js';
import { PlifError } from '../src/errors.js';
import { EventBus } from '../src/events/bus.js';
import { McpRegistry, parseServerConfigs } from '../src/harness/mcp.js';
import type { ToolContext } from '../src/harness/tools.js';

interface ProtectedMcpFixture {
  readonly url: string;
  readonly counters: {
    register: number;
    token: number;
    unauthorized: number;
    call: number;
  };
  approve(authorizationUrl: URL): Promise<void>;
  revokeTokens(): void;
  close(): Promise<void>;
}

async function startProtectedMcp(
  options: { anonymous?: boolean } = {},
): Promise<ProtectedMcpFixture> {
  const counters = { register: 0, token: 0, unauthorized: 0, call: 0 };
  const pendingCodes = new Set<string>();
  const validTokens = new Set<string>();
  let codeSeq = 0;
  let tokenSeq = 0;
  let base = 'http://127.0.0.1';

  const readBody = async (request: http.IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  };

  const json = (response: http.ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };

  const reply = (jsonrpcId: unknown, result: unknown) => ({ jsonrpc: '2.0', id: jsonrpcId, result });

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', base);

      if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
        json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
        return;
      }

      if (url.pathname === '/.well-known/oauth-authorization-server') {
        json(response, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          code_challenge_methods_supported: ['S256'],
        });
        return;
      }

      if (url.pathname === '/register' && request.method === 'POST') {
        counters.register += 1;
        const metadata = JSON.parse(await readBody(request)) as Record<string, unknown>;
        json(response, 201, { ...metadata, client_id: 'plif-test-client' });
        return;
      }

      if (url.pathname === '/token' && request.method === 'POST') {
        counters.token += 1;
        const form = new URLSearchParams(await readBody(request));
        const code = form.get('code') ?? '';
        if (!form.get('code_verifier') || !pendingCodes.delete(code)) {
          json(response, 400, { error: 'invalid_grant' });
          return;
        }
        tokenSeq += 1;
        const token = `access-${tokenSeq}`;
        validTokens.add(token);
        json(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
        return;
      }

      if (url.pathname !== '/mcp') {
        response.writeHead(404).end();
        return;
      }

      if (request.method === 'GET') {
        response.writeHead(405).end();
        return;
      }
      if (request.method === 'DELETE') {
        response.writeHead(200).end();
        return;
      }

      const header = request.headers['authorization'];
      const bearer = typeof header === 'string' ? header.replace(/^Bearer /i, '') : '';
      if (!options.anonymous && !validTokens.has(bearer)) {
        counters.unauthorized += 1;
        response
          .writeHead(401, {
            'content-type': 'application/json',
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          })
          .end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      const message = JSON.parse(await readBody(request)) as { id?: unknown; method?: string };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (message.method === 'initialize') {
        json(response, 200, reply(message.id, {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'protected-fixture', version: '1.0.0' },
        }));
        return;
      }
      if (message.method === 'tools/list') {
        json(response, 200, reply(message.id, {
          tools: [{ name: 'hello', description: 'greets', inputSchema: { type: 'object', properties: {} } }],
        }));
        return;
      }
      if (message.method === 'tools/call') {
        counters.call += 1;
        json(response, 200, reply(message.id, { content: [{ type: 'text', text: 'authenticated' }] }));
        return;
      }
      json(response, 200, reply(message.id, {}));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: `${base}/mcp`,
    counters,
    async approve(authorizationUrl: URL): Promise<void> {
      const state = authorizationUrl.searchParams.get('state');
      const redirect = authorizationUrl.searchParams.get('redirect_uri');
      assert.ok(state, 'authorization URL carries a state');
      assert.ok(redirect, 'authorization URL carries a redirect_uri');
      codeSeq += 1;
      const code = `code-${codeSeq}`;
      pendingCodes.add(code);
      const callback = new URL(redirect);
      callback.searchParams.set('state', state);
      callback.searchParams.set('code', code);
      const delivered = await fetch(callback);
      assert.equal(delivered.status, 200);
    },
    revokeTokens(): void {
      validTokens.clear();
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('MCP OAuth credential store', () => {
  it('isolates MCP keys and clears only the requested scope', async () => {
    const store = new MemoryMcpOAuthStore();
    await store.save('mcp:a', {
      tokens: { access_token: 'a', token_type: 'Bearer', refresh_token: 'ra' },
      codeVerifier: 'va',
    });
    await store.save('mcp:b', { tokens: { access_token: 'b', token_type: 'Bearer' } });

    await store.clear('mcp:a', 'tokens');

    assert.deepEqual(await store.load('mcp:a'), { codeVerifier: 'va' });
    assert.equal((await store.load('mcp:b'))?.tokens?.access_token, 'b');
  });

  it('does not expose mutable references', async () => {
    const store = new MemoryMcpOAuthStore();
    const state = { tokens: { access_token: 'original', token_type: 'Bearer' } };
    await store.save('key', state);
    state.tokens.access_token = 'changed';
    const loaded = await store.load('key');
    assert.equal(loaded?.tokens?.access_token, 'original');
  });

  it('uses a stable endpoint key without query-string credentials', () => {
    assert.equal(
      mcpOAuthKey('github', 'https://example.test/mcp?secret=a'),
      mcpOAuthKey('github', 'https://example.test/mcp?secret=b'),
    );
  });

  it('persists only transformed data through the DPAPI seam', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plif-oauth-store-'));
    const runner = async (_mode: 'protect' | 'unprotect', input: string) =>
      [...input].reverse().join('');
    const store = new WindowsDpapiOAuthStore(root, runner);
    await store.save('server', {
      tokens: { access_token: 'private-token', token_type: 'Bearer' },
    });

    const files = await import('node:fs/promises').then((fs) => fs.readdir(root));
    const disk = await readFile(path.join(root, files[0]!), 'utf8');
    assert.equal(disk.includes('private-token'), false);
    assert.equal((await store.load('server'))?.tokens?.access_token, 'private-token');
  });
});

describe('MCP OAuth provider', () => {
  it('persists SDK credentials without placing them in events', async () => {
    const events: McpAuthEvent[] = [];
    const bus = new EventBus();
    bus.on('auth.required', (event) => events.push(event));
    const coordinator = new McpOAuthCoordinator(bus, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: async () => undefined,
    });
    await coordinator.start();
    const provider = coordinator.providerFor('github', new URL('https://mcp.example.test/mcp'));
    await provider.saveTokens({ access_token: 'never-in-events', token_type: 'Bearer' });
    await provider.saveCodeVerifier('private-verifier');

    assert.equal((await provider.tokens())?.access_token, 'never-in-events');
    assert.equal(await provider.codeVerifier(), 'private-verifier');
    assert.equal(JSON.stringify(events).includes('never-in-events'), false);
    await coordinator.close();
  });

  it('opens authorization and resolves only the matching callback once', async () => {
    const events: McpAuthEvent[] = [];
    const opened: URL[] = [];
    const bus = new EventBus();
    bus.on('auth.required', (event) => events.push(event));
    const coordinator = new McpOAuthCoordinator(bus, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: async (url) => { opened.push(url); },
    });
    await coordinator.start();
    const provider = coordinator.providerFor('github', new URL('https://mcp.example.test/mcp'));
    const state = provider.state();
    const authorization = new URL(`https://login.example.test/authorize?state=${state}`);

    await provider.redirectToAuthorization(authorization);
    assert.equal(opened[0]?.origin, 'https://login.example.test');
    assert.equal(events.at(-1)?.phase, 'waiting');
    await fetch(`${provider.redirectUrl}?state=wrong&code=bad`);
    const success = new URL(provider.redirectUrl);
    success.searchParams.set('state', state);
    success.searchParams.set('code', 'ok');
    await fetch(success);
    assert.equal(await provider.waitForCallback(), 'ok');
    const duplicate = await fetch(success);
    assert.equal(duplicate.status, 400);
    await coordinator.close();
  });

  it('keeps the login usable when no browser can be opened', async () => {
    const events: McpAuthEvent[] = [];
    const bus = new EventBus();
    bus.on('auth.required', (event) => events.push(event));
    const coordinator = new McpOAuthCoordinator(bus, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: async () => {
        throw new Error('no browser on this machine');
      },
    });
    await coordinator.start();
    const provider = coordinator.providerFor('github', new URL('https://mcp.example.test/mcp'));
    const state = provider.state();
    const authorization = new URL(`https://login.example.test/authorize?state=${state}`);

    await provider.redirectToAuthorization(authorization);

    assert.deepEqual(events.map((event) => event.phase), ['required', 'waiting']);
    assert.match(events.at(-1)?.detail ?? '', /browser/i);
    assert.equal(events.at(-1)?.authorizationUrl, authorization.toString());

    const success = new URL(provider.redirectUrl);
    success.searchParams.set('state', state);
    success.searchParams.set('code', 'opened-by-hand');
    await fetch(success);
    assert.equal(await provider.waitForCallback(), 'opened-by-hand');
    await coordinator.close();
  });
});

describe('OAuth-protected HTTP MCP', () => {
  const laterApproval = (fixture: ProtectedMcpFixture, approvals: Promise<void>[]) =>
    async (url: URL): Promise<void> => {
      approvals.push(fixture.approve(url));
    };

  it('authenticates, reconnects, lists tools, and calls one tool', async () => {
    const fixture = await startProtectedMcp();
    const approvals: Promise<void>[] = [];
    const events: McpAuthEvent[] = [];
    const bus = new EventBus();
    bus.on('auth.required', (event) => events.push(event));
    const coordinator = new McpOAuthCoordinator(bus, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: laterApproval(fixture, approvals),
    });
    await coordinator.start();

    const registry = await McpRegistry.connect({ protected: { url: fixture.url } }, bus, {
      oauth: coordinator,
    });

    try {
      assert.deepEqual(
        registry.tools().map((tool) => tool.spec.name),
        ['mcp__protected__hello'],
      );
      assert.equal(registry.statuses()[0]?.connected, true);
      assert.ok(fixture.counters.unauthorized >= 1, 'the first attempt was rejected');
      assert.equal(fixture.counters.register, 1);
      assert.equal(fixture.counters.token, 1);

      const result = await registry.tools()[0]!.run({}, {} as ToolContext);
      assert.equal(result.output, 'authenticated');
      assert.equal(result.ok, true);
      assert.equal(fixture.counters.call, 1);

      assert.deepEqual(
        events.map((event) => event.phase),
        ['required', 'opened', 'waiting', 'completed'],
      );
      assert.doesNotMatch(JSON.stringify(events), /access-|code-|code_verifier/);
    } finally {
      await registry.close();
      await fixture.close();
      await Promise.all(approvals);
    }
  });

  it('re-authenticates and retries a tool call exactly once when the token stops working', async () => {
    const fixture = await startProtectedMcp();
    const approvals: Promise<void>[] = [];
    const coordinator = new McpOAuthCoordinator(undefined, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: laterApproval(fixture, approvals),
    });
    await coordinator.start();

    const registry = await McpRegistry.connect({ protected: { url: fixture.url } }, undefined, {
      oauth: coordinator,
    });

    try {
      assert.equal(fixture.counters.token, 1);
      fixture.revokeTokens();

      const result = await registry.tools()[0]!.run({}, {} as ToolContext);
      assert.equal(result.output, 'authenticated');
      assert.equal(fixture.counters.token, 2, 'the code was exchanged a second time');
      assert.equal(fixture.counters.call, 1, 'the original call ran once, after recovery');
      assert.equal(fixture.counters.register, 1, 'the stored client survived the reconnect');
      assert.equal(registry.statuses()[0]?.connected, true);
    } finally {
      await registry.close();
      await fixture.close();
      await Promise.all(approvals);
    }
  });

  it('logs in on demand, even while the token it holds still works', async () => {
    const fixture = await startProtectedMcp();
    const approvals: Promise<void>[] = [];
    const coordinator = new McpOAuthCoordinator(undefined, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: laterApproval(fixture, approvals),
    });
    await coordinator.start();

    const registry = await McpRegistry.connect({ protected: { url: fixture.url } }, undefined, {
      oauth: coordinator,
    });

    try {
      assert.equal(fixture.counters.token, 1);

      const { status, authenticated } = await registry.login('protected');

      assert.equal(status.connected, true);
      assert.equal(status.toolCount, 1);
      assert.equal(authenticated, true, 'this one really did authenticate');
      assert.equal(fixture.counters.token, 2, 'a second code was exchanged');
      assert.equal(fixture.counters.register, 1, 'the stored client survived the login');

      const result = await registry.tools()[0]!.run({}, {} as ToolContext);
      assert.equal(result.output, 'authenticated');
    } finally {
      await registry.close();
      await fixture.close();
      await Promise.all(approvals);
    }
  });

  it('does not call an anonymous connection a login', async () => {
    // What context7 actually does: it serves callers with no key at all, so a
    // login that reported success was reporting something that never happened.
    const fixture = await startProtectedMcp({ anonymous: true });
    const opened: URL[] = [];
    const coordinator = new McpOAuthCoordinator(undefined, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: async (url) => {
        opened.push(url);
      },
    });
    await coordinator.start();

    const configs = parseServerConfigs(
      { anon: { url: fixture.url, headers: { Authorization: '${PLIF_TEST_KEY:-}' } } },
      {},
    );
    const registry = await McpRegistry.connect(configs, undefined, { oauth: coordinator });

    try {
      const result = await registry.login('anon');

      assert.equal(result.status.connected, true);
      assert.equal(result.authenticated, false, 'connecting is not authenticating');
      assert.deepEqual(result.unsetVariables, ['PLIF_TEST_KEY']);
      assert.equal(opened.length, 0, 'nothing to open a browser for');
      assert.equal(fixture.counters.token, 0, 'no code was ever exchanged');
    } finally {
      await registry.close();
      await fixture.close();
    }
  });

  it('says which servers exist when asked to log in to one that does not', async () => {
    const fixture = await startProtectedMcp();
    const approvals: Promise<void>[] = [];
    const coordinator = new McpOAuthCoordinator(undefined, {
      store: new MemoryMcpOAuthStore(),
      openBrowser: laterApproval(fixture, approvals),
    });
    await coordinator.start();

    const registry = await McpRegistry.connect({ protected: { url: fixture.url } }, undefined, {
      oauth: coordinator,
    });

    try {
      await assert.rejects(registry.login('typo'), (error: unknown) => {
        assert.match(String(error), /typo/);
        assert.deepEqual((error as PlifError).detail['known'], ['protected']);
        return true;
      });
      assert.equal(registry.statuses()[0]?.connected, true, 'the healthy server was left alone');
    } finally {
      await registry.close();
      await fixture.close();
      await Promise.all(approvals);
    }
  });

  it('refuses to log in to a local process, which has no account', async () => {
    const registry = await McpRegistry.connect({
      local: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
    });

    try {
      await assert.rejects(registry.login('local'), /does not authenticate/);
    } finally {
      await registry.close();
    }
  });

  it('does not open a browser or wait for a callback without a terminal', async () => {
    const fixture = await startProtectedMcp();
    const opened: URL[] = [];
    const coordinator = new McpOAuthCoordinator(undefined, {
      store: new MemoryMcpOAuthStore(),
      interactive: false,
      openBrowser: async (url) => {
        opened.push(url);
      },
    });
    await coordinator.start();

    const registry = await McpRegistry.connect({ protected: { url: fixture.url } }, undefined, {
      oauth: coordinator,
    });

    try {
      assert.equal(opened.length, 0);
      assert.equal(registry.tools().length, 0);
      const status = registry.statuses()[0];
      assert.equal(status?.connected, false);
      assert.match(status?.detail ?? '', /interactive|terminal/i);
      assert.doesNotMatch(status?.detail ?? '', /access-|code_verifier|Bearer/);
    } finally {
      await registry.close();
      await fixture.close();
    }
  });
});
