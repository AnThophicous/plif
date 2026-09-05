/**
 * Proxy selection, and the gateway headers a custom provider can declare.
 *
 * Both exist for the same reason: an endpoint that is reachable from the
 * machine but not from plif. The proxy rules are tested exhaustively because
 * getting `NO_PROXY` wrong is silent — traffic for an internal host goes out
 * through the proxy, or the reverse, and the symptom is "the model server is
 * down".
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { describeProxy, proxyForUrl } from '../src/model/proxy.js';
import { expandHeaders } from '../src/config/expand.js';
import { resolveConfig } from '../src/model/config.js';
import { OpenAIProvider } from '../src/model/openai.js';

describe('proxy selection', () => {
  it('sends https traffic through HTTPS_PROXY', () => {
    assert.equal(
      proxyForUrl('https://api.openai.com/v1', { HTTPS_PROXY: 'http://proxy.corp:3128' }),
      'http://proxy.corp:3128',
    );
  });

  it('prefers the lowercase variable, the way curl does', () => {
    assert.equal(
      proxyForUrl('https://api.openai.com/v1', {
        https_proxy: 'http://lower:3128',
        HTTPS_PROXY: 'http://upper:3128',
      }),
      'http://lower:3128',
    );
  });

  it('falls back to ALL_PROXY when the scheme-specific one is unset', () => {
    assert.equal(
      proxyForUrl('https://api.openai.com/v1', { ALL_PROXY: 'http://any:3128' }),
      'http://any:3128',
    );
  });

  it('does not use HTTP_PROXY for an https endpoint', () => {
    assert.equal(proxyForUrl('https://api.openai.com/v1', { HTTP_PROXY: 'http://plain:3128' }), null);
  });

  it('accepts the bare host:port people actually write', () => {
    assert.equal(
      proxyForUrl('https://api.openai.com/v1', { HTTPS_PROXY: 'proxy.corp:3128' }),
      'http://proxy.corp:3128',
    );
  });

  it('never proxies a local model server', () => {
    for (const target of ['http://localhost:1234/v1', 'http://127.0.0.1:11434/v1']) {
      assert.equal(proxyForUrl(target, { HTTP_PROXY: 'http://proxy.corp:3128' }), null);
    }
  });

  it('returns nothing when the environment is silent', () => {
    assert.equal(proxyForUrl('https://api.openai.com/v1', {}), null);
  });

  it('ignores a proxy value that is not a URL', () => {
    assert.equal(proxyForUrl('https://api.openai.com/v1', { HTTPS_PROXY: 'http://:::' }), null);
  });
});

describe('NO_PROXY', () => {
  const proxied = { HTTPS_PROXY: 'http://proxy.corp:3128' };

  it('exempts an exact host', () => {
    assert.equal(
      proxyForUrl('https://models.internal/v1', { ...proxied, NO_PROXY: 'models.internal' }),
      null,
    );
  });

  it('exempts subdomains at a label boundary, and only there', () => {
    assert.equal(
      proxyForUrl('https://api.example.com/v1', { ...proxied, NO_PROXY: 'example.com' }),
      null,
    );
    // The bug this guards: a suffix match without the boundary would exempt an
    // unrelated third-party host and leak internal traffic straight out.
    assert.equal(
      proxyForUrl('https://notexample.com/v1', { ...proxied, NO_PROXY: 'example.com' }),
      'http://proxy.corp:3128',
    );
  });

  it('accepts the leading-dot and wildcard spellings', () => {
    for (const entry of ['.example.com', '*.example.com']) {
      assert.equal(proxyForUrl('https://api.example.com/v1', { ...proxied, NO_PROXY: entry }), null);
    }
  });

  it('honours a port when one is given', () => {
    assert.equal(
      proxyForUrl('https://models.internal:8443/v1', { ...proxied, NO_PROXY: 'models.internal:8443' }),
      null,
    );
    assert.equal(
      proxyForUrl('https://models.internal:9000/v1', { ...proxied, NO_PROXY: 'models.internal:8443' }),
      'http://proxy.corp:3128',
    );
  });

  it('disables proxying entirely for "*"', () => {
    assert.equal(proxyForUrl('https://api.openai.com/v1', { ...proxied, NO_PROXY: '*' }), null);
  });

  it('reads a comma-separated list with spaces', () => {
    const env = { ...proxied, NO_PROXY: 'localhost, .internal , example.com' };
    assert.equal(proxyForUrl('https://host.internal/v1', env), null);
    assert.equal(proxyForUrl('https://api.example.com/v1', env), null);
    assert.equal(proxyForUrl('https://api.openai.com/v1', env), 'http://proxy.corp:3128');
  });
});

describe('proxy description', () => {
  it('names the route without leaking credentials in the proxy URL', () => {
    const described = describeProxy('https://api.openai.com/v1', {
      HTTPS_PROXY: 'http://user:hunter2@proxy.corp:3128',
    });
    assert.equal(described, 'via http://proxy.corp:3128');
    assert.ok(!described.includes('hunter2'));
  });

  it('distinguishes "no proxy configured" from "excluded by NO_PROXY"', () => {
    assert.equal(describeProxy('https://api.openai.com/v1', {}), 'direct');
    assert.equal(
      describeProxy('https://api.openai.com/v1', {
        HTTPS_PROXY: 'http://proxy.corp:3128',
        NO_PROXY: 'openai.com',
      }),
      'direct (excluded by NO_PROXY)',
    );
  });
});

describe('gateway headers', () => {
  it('expands ${VAR} and drops a header whose credential is unset', () => {
    const { headers, unsetVariables } = expandHeaders(
      {
        'x-portkey-provider': 'openai',
        'x-portkey-api-key': '${PORTKEY_KEY}',
        'x-tenant': '${TENANT:-default}',
      },
      { TENANT: '' },
    );
    assert.deepEqual(headers, { 'x-portkey-provider': 'openai', 'x-tenant': 'default' });
    assert.deepEqual(unsetVariables, ['PORTKEY_KEY']);
  });

  it('drops a half-formed credential rather than sending "Bearer "', () => {
    const { headers, unsetVariables } = expandHeaders({ authorization: 'Bearer ${GATEWAY_KEY:-}' }, {});
    assert.deepEqual(headers, {});
    assert.deepEqual(unsetVariables, ['GATEWAY_KEY']);
  });

  it('reaches the resolved config of a custom provider', () => {
    const config = resolveConfig(
      {
        providers: {
          gateway: {
            options: { baseURL: 'https://gateway.corp/v1', apiKey: 'sk-gateway' },
            headers: { 'x-tenant': '${TENANT}' },
          },
        },
      } as never,
      { preset: 'gateway', model: 'gpt-4o-mini', env: { TENANT: 'acme' } },
    );
    assert.deepEqual(config.headers, { 'x-tenant': 'acme' });
  });

  it('is not offered to a built-in preset, whose contract the preset table owns', () => {
    const config = resolveConfig({} as never, {
      preset: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      env: {},
    });
    assert.equal(config.headers, undefined);
  });
});

describe('gateway headers on the wire', () => {
  let server: http.Server;
  let baseURL: string;
  let seen: http.IncomingHttpHeaders | undefined;

  before(async () => {
    server = http.createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // A complete stream, finish reason included: an incomplete one is
      // retried three times and the assertion would then be about whichever
      // attempt happened last.
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: 'ok' }, finish_reason: null }],
        })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends the declared headers with the request', async () => {
    const provider = new OpenAIProvider({
      model: 'fake',
      baseURL,
      apiKey: 'sk-test',
      headers: { 'x-tenant': 'acme', 'x-portkey-provider': 'openai' },
      temperature: 0,
      maxTokens: undefined,
      timeoutMs: 5_000,
    });

    for await (const _event of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      // Drain; the assertion is about what the endpoint received.
    }

    assert.equal(seen?.['x-tenant'], 'acme');
    assert.equal(seen?.['x-portkey-provider'], 'openai');
    // The bearer token must survive alongside them.
    assert.equal(seen?.['authorization'], 'Bearer sk-test');
  });
});
