/**
 * The Plif effort ladder, and what it costs to discover a model's limits.
 *
 * Plif mode negotiates the highest reasoning level an endpoint accepts by
 * trying `max` and stepping down. Every refused rung is a real request that
 * produced nothing, so the tests here are mostly about how few of those a
 * session has to spend — and about the bottom rung, where refusing used to
 * fail the turn outright.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { OpenAIProvider } from '../src/model/openai.js';
import { memoryCapabilityCache } from '../src/model/capabilities.js';
import type { CompletionEvent } from '../src/model/provider.js';

/** Records what each request asked for, and answers as the scenario dictates. */
interface Endpoint {
  readonly baseURL: string;
  readonly efforts: (string | undefined)[];
  accepts: ReadonlySet<string> | 'none';
  reset(): void;
}

let server: http.Server;
let endpoint: Endpoint;

before(async () => {
  const efforts: (string | undefined)[] = [];
  const state = { accepts: new Set(['low']) as ReadonlySet<string> | 'none' };

  server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += String(chunk); });
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as { reasoning_effort?: string };
      const asked = body.reasoning_effort;
      efforts.push(asked);

      const ok = state.accepts === 'none' ? asked === undefined : asked === undefined || state.accepts.has(asked);
      if (!ok) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          error: { message: `Unsupported value: 'reasoning_effort' does not support '${asked}'. Must be one of the supported values.` },
        }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  endpoint = {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    efforts,
    get accepts() { return state.accepts; },
    set accepts(value) { state.accepts = value; },
    reset() { efforts.length = 0; },
  } as Endpoint;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function provider(options: {
  cache?: ReturnType<typeof memoryCapabilityCache>;
  model?: string;
  reasoning?: boolean;
} = {}) {
  return new OpenAIProvider(
    {
      model: options.model ?? 'test-model',
      baseURL: endpoint.baseURL,
      apiKey: 'sk-test',
      effort: 'plif',
      temperature: 0,
      maxTokens: undefined,
      timeoutMs: 5_000,
      ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
    },
    options.cache ? { capabilityCache: options.cache } : {},
  );
}

async function drain(events: AsyncGenerator<CompletionEvent>): Promise<void> {
  for await (const _event of events) {
    // The assertions are about the requests, not the reply.
  }
}

describe('the Plif effort ladder', () => {
  it('walks down from max until the endpoint accepts one', async () => {
    endpoint.accepts = new Set(['low']);
    endpoint.reset();
    await drain(provider().stream({ messages: [{ role: 'user', content: 'hi' }] }));

    assert.deepEqual(endpoint.efforts, ['max', 'xhigh', 'high', 'medium', 'low']);
  });

  it('starts from the cached level instead of walking again', async () => {
    // The whole point of the cache: four refused requests, once, not per run.
    endpoint.accepts = new Set(['low']);
    const cache = memoryCapabilityCache();

    endpoint.reset();
    await drain(provider({ cache }).stream({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(endpoint.efforts.length, 5, 'the first session pays for discovery');

    endpoint.reset();
    await drain(provider({ cache }).stream({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.deepEqual(endpoint.efforts, ['low'], 'the second session pays nothing');
  });

  it('finishes the turn on a model that refuses every level', async () => {
    // This used to fail: at the bottom rung the rejection fell through to the
    // transport path and the turn died, so a model that does not speak
    // reasoning_effort at all was unusable in the mode meant to adapt to it.
    endpoint.accepts = 'none';
    endpoint.reset();
    await drain(provider().stream({ messages: [{ role: 'user', content: 'hi' }] }));

    assert.deepEqual(endpoint.efforts, ['max', 'xhigh', 'high', 'medium', 'low', undefined]);
    assert.equal(endpoint.efforts.at(-1), undefined, 'the last attempt sends no field at all');
  });

  it('remembers that a model takes no reasoning level, and stops asking', async () => {
    endpoint.accepts = 'none';
    const cache = memoryCapabilityCache();

    endpoint.reset();
    await drain(provider({ cache }).stream({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(endpoint.efforts.length, 6);

    endpoint.reset();
    await drain(provider({ cache }).stream({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.deepEqual(endpoint.efforts, [undefined], 'one request, no field, no negotiation');
  });

  it('never caches a level the endpoint was not actually sent', async () => {
    // If the successful request carried no field, recording the rung it would
    // have used would make the next session send it and fail.
    endpoint.accepts = 'none';
    const cache = memoryCapabilityCache();
    endpoint.reset();
    await drain(provider({ cache }).stream({ messages: [{ role: 'user', content: 'hi' }] }));

    assert.equal(await cache.get(endpoint.baseURL, 'test-model'), 'none');
  });

  it('skips negotiation entirely for a model declared as non-reasoning', async () => {
    // A custom provider that declares its models needs no discovery at all;
    // walking the ladder to rediscover a stated fact cost five refused
    // requests on the first turn of every fresh session.
    endpoint.accepts = 'none';
    endpoint.reset();
    await drain(provider({ reasoning: false }).stream({ messages: [{ role: 'user', content: 'hi' }] }));

    assert.deepEqual(endpoint.efforts, [undefined], 'no rung was ever tried');
  });

  it('still negotiates for a model declared as reasoning', async () => {
    // `true` says the model thinks, not which level names its endpoint takes.
    endpoint.accepts = new Set(['medium']);
    endpoint.reset();
    await drain(provider({ reasoning: true }).stream({ messages: [{ role: 'user', content: 'hi' }] }));

    assert.deepEqual(endpoint.efforts, ['max', 'xhigh', 'high', 'medium']);
  });
});
