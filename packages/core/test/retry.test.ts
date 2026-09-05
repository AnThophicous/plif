/**
 * Riding out an endpoint that is having a bad minute.
 *
 * The failure this exists for was observed, not imagined: OpenCode Zen
 * returning `[500] Internal server error: function_call arguments JSON parse
 * error` in the middle of a turn already thirty seconds in. One transient 500
 * from an upstream should not cost the turn.
 *
 * Driven through the provider's own network seam, so the backoff schedule is
 * asserted exactly and a scenario spanning four minutes of waiting runs in
 * milliseconds.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it, mock } from 'node:test';
import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';

import { OpenAIProvider } from '../src/model/openai.js';
import { memoryCapabilityCache } from '../src/model/capabilities.js';
import type { EffortCapabilityCache } from '../src/model/capabilities.js';
import { collect } from '../src/model/provider.js';
import type { CompletionEvent } from '../src/model/provider.js';
import { PlifError } from '../src/errors.js';

const CONFIG = {
  baseURL: 'https://opencode.ai/zen/v1',
  model: 'deepseek-v4-flash-free',
  apiKey: '',
  temperature: 0.2,
  timeoutMs: 1_000,
};

/** An SDK error, the way the OpenAI client throws one. */
function apiError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function retryAfterError(seconds: number): Error & { status: number; headers: Record<string, string> } {
  const error = apiError(429, 'slow down') as Error & {
    status: number;
    headers: Record<string, string>;
  };
  error.headers = { 'retry-after': String(seconds) };
  return error;
}

function chunk(content: string): unknown {
  return { choices: [{ delta: { content }, finish_reason: null }] };
}

function contentSnapshot(content: string): unknown {
  return { choices: [{ delta: { content }, finish_reason: null }] };
}

function reasoningSnapshot(text: string): unknown {
  return { choices: [{ delta: { reasoning_details: [{ text }] }, finish_reason: null }] };
}

function reasoningDelta(text: string): unknown {
  return { choices: [{ delta: { reasoning_content: text }, finish_reason: null }] };
}

const FINISH = {
  choices: [{ delta: {}, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
};

/** One scripted attempt: throw, or stream these chunks (an Error ends it). */
type Attempt = Error | readonly unknown[];

class ScriptedProvider extends OpenAIProvider {
  attempts = 0;
  waits: number[] = [];
  #script: readonly Attempt[];

  constructor(
    script: readonly Attempt[],
    overrides: Partial<ConstructorParameters<typeof OpenAIProvider>[0]> = {},
  ) {
    super({ ...CONFIG, ...overrides } as ConstructorParameters<typeof OpenAIProvider>[0]);
    this.#script = script;
  }

  protected override createStream(): Promise<AsyncIterable<never>> {
    const step = this.#script[this.attempts];
    this.attempts += 1;
    if (step === undefined) return Promise.reject(apiError(500, 'script exhausted'));
    if (step instanceof Error) return Promise.reject(step);

    return Promise.resolve({
      async *[Symbol.asyncIterator]() {
        for (const item of step) {
          // An Error inside the chunk list means the stream died part-way,
          // which is the case that makes a reset necessary.
          if (item instanceof Error) throw item;
          yield item as never;
        }
      },
    });
  }

  protected override waitBeforeRetry(ms: number, signal?: AbortSignal): Promise<void> {
    this.waits.push(ms);
    return signal?.aborted ? Promise.reject(new Error('aborted')) : Promise.resolve();
  }
}

class StallThenSuccessProvider extends OpenAIProvider {
  attempts = 0;

  constructor() {
    super({ ...CONFIG } as ConstructorParameters<typeof OpenAIProvider>[0]);
  }

  protected override createStream(): Promise<AsyncIterable<never>> {
    this.attempts += 1;
    if (this.attempts === 1) {
      return Promise.resolve({
        [Symbol.asyncIterator]() {
          return { next: () => new Promise<IteratorResult<never>>(() => undefined) };
        },
      });
    }
    return Promise.resolve({
      async *[Symbol.asyncIterator]() {
        yield chunk('alive') as never;
        yield FINISH as never;
      },
    });
  }

  protected override waitBeforeRetry(): Promise<void> {
    return Promise.resolve();
  }

  protected override interChunkTimeoutMs(): number {
    return 5;
  }

  protected override firstChunkTimeoutMs(): number {
    return 5;
  }
}

class WaitlessHttpProvider extends OpenAIProvider {
  protected override waitBeforeRetry(): Promise<void> {
    return Promise.resolve();
  }
}

class ExposedTimeoutProvider extends OpenAIProvider {
  first(): number {
    return this.firstChunkTimeoutMs();
  }

  between(): number {
    return this.interChunkTimeoutMs();
  }
}

async function listen(
  handler: Parameters<typeof http.createServer>[0],
): Promise<{ server: http.Server; baseURL: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseURL: `http://127.0.0.1:${port}/v1` };
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

class PlifCapabilityProvider extends OpenAIProvider {
  efforts: string[] = [];

  constructor(capabilityCache?: EffortCapabilityCache) {
    super(
      { ...CONFIG, effort: 'plif' } as ConstructorParameters<typeof OpenAIProvider>[0],
      capabilityCache ? { capabilityCache } : {},
    );
  }

  protected override createStream(
    body: Parameters<OpenAIProvider['createStream']>[0],
  ): Promise<AsyncIterable<never>> {
    const effort = String((body as { reasoning_effort?: unknown }).reasoning_effort ?? '');
    this.efforts.push(effort);
    if (effort !== 'medium') {
      return Promise.reject(apiError(400, 'reasoning_effort must be one of: medium, low'));
    }
    return Promise.resolve({
      async *[Symbol.asyncIterator]() {
        yield chunk('negotiated') as never;
        yield FINISH as never;
      },
    });
  }
}

function stableJitter(): void {
  mock.method(Math, 'random', () => 0.5);
}

async function events(stream: AsyncGenerator<CompletionEvent>): Promise<CompletionEvent[]> {
  const all: CompletionEvent[] = [];
  for await (const event of stream) all.push(event);
  return all;
}

const ask = { messages: [{ role: 'user' as const, content: 'x' }] };

afterEach(() => mock.restoreAll());

describe('retry schedule', () => {
  it('reconciles a cumulative content snapshot into one visible answer', async () => {
    const provider = new ScriptedProvider([
      [contentSnapshot('O'), contentSnapshot('Olá'), contentSnapshot('Olá '), contentSnapshot('Olá mundo'), FINISH],
    ], { streamSemantics: 'snapshot' });

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'Olá mundo');
  });

  it('does not append a full final message after streamed deltas', async () => {
    const provider = new ScriptedProvider([[
      chunk('Olá '),
      {
        choices: [{
          delta: {},
          message: { content: 'Olá mundo' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      },
      // A gateway may repeat its terminal frame while closing the stream.
      {
        choices: [{ delta: {}, message: { content: 'Olá mundo' }, finish_reason: 'stop' }],
      },
    ]]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'Olá mundo');
    assert.equal(result.reason, 'stop');
  });
  it('normalizes short cumulative reasoning through the provider event path', async () => {
    const provider = new ScriptedProvider([
      [reasoningSnapshot('a'), reasoningSnapshot('ab'), reasoningSnapshot('abc'), FINISH],
    ]);

    const all = await events(provider.stream(ask));
    assert.deepEqual(
      all.filter((event) => event.kind === 'reasoning').map((event) => event.delta),
      ['a', 'b', 'c'],
    );
  });

  it('does not turn an unchanged reasoning chunk into an infinite repeated stream', async () => {
    const provider = new ScriptedProvider([
      [...Array.from({ length: 12 }, () => reasoningSnapshot('Asp')), FINISH],
    ]);

    const all = await events(provider.stream(ask));
    assert.deepEqual(
      all.filter((event) => event.kind === 'reasoning').map((event) => event.delta),
      ['Asp'],
    );
  });

  it('negotiates Plif down to the highest effort an endpoint accepts', async () => {
    const provider = new PlifCapabilityProvider();

    const result = await collect(provider.stream(ask));

    assert.equal(result.text, 'negotiated');
    assert.deepEqual(provider.efforts, ['max', 'xhigh', 'high', 'medium']);
  });

  it('tries a cached accepted effort before probing the ladder', async () => {
    const cache = memoryCapabilityCache({
      endpoint: CONFIG.baseURL,
      model: CONFIG.model,
      effort: 'medium',
    });
    const provider = new PlifCapabilityProvider(cache);
    await collect(provider.stream(ask));
    assert.deepEqual(provider.efforts, ['medium']);
  });

  it('uses capped exponential backoff', async () => {
    stableJitter();
    const provider = new ScriptedProvider([
      apiError(500, 'Internal server error'),
      apiError(500, 'Internal server error'),
      [chunk('finally'), FINISH],
    ]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'finally');
    assert.deepEqual(provider.waits, [1_000, 2_000]);
  });

  it('announces the attempt before the wait, so the silence is explained', async () => {
    stableJitter();
    const provider = new ScriptedProvider([apiError(503, 'upstream is down'), [chunk('ok'), FINISH]]);

    const all = await events(provider.stream(ask));
    const retry = all.find((event) => event.kind === 'retry');
    assert.ok(retry?.kind === 'retry');
    assert.equal(retry.attempt, 1);
    assert.equal(retry.of, 3);
    assert.equal(retry.waitMs, 1_000);
  });

  it('honors Retry-After instead of inventing a shorter delay', async () => {
    stableJitter();
    const provider = new ScriptedProvider([retryAfterError(7), [chunk('ok'), FINISH]]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'ok');
    assert.deepEqual(provider.waits, [7_000]);
  });

  it('gives up after the visible retry budget and says so', async () => {
    stableJitter();
    const provider = new ScriptedProvider(
      Array.from({ length: 14 }, () => apiError(500, 'Internal server error')),
    );

    await assert.rejects(collect(provider.stream(ask)), (error: unknown) => {
      assert.ok(PlifError.is(error));
      assert.match(error.message, /gave up after 3 attempts/);
      return true;
    });
    assert.equal(provider.attempts, 3);
  });

  it('discards a half-delivered turn before redoing it', async () => {
    // The nasty one: the endpoint dies *after* streaming part of the answer.
    // Without a reset the retry's text is appended to the abandoned attempt,
    // and the model is handed both halves back as its own previous turn.
    stableJitter();
    const provider = new ScriptedProvider([
      [chunk('The answer is '), apiError(500, 'died mid-stream')],
      [chunk('The answer is 42.'), FINISH],
    ]);

    const all = await events(provider.stream(ask));
    assert.ok(
      all.some((event) => event.kind === 'reset'),
      'a partially delivered attempt must be reset before the retry',
    );

    const replayed = await collect(
      (async function* replay() {
        for (const event of all) yield event;
      })(),
    );
    assert.equal(replayed.text, 'The answer is 42.');
  });

  it('retries a clean EOF that never included finish_reason', async () => {
    stableJitter();
    const provider = new ScriptedProvider([
      [chunk('The answer was cut off')],
      [chunk('The complete answer.'), FINISH],
    ]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'The complete answer.');
    assert.equal(provider.attempts, 2);
  });

  it('recognises the SDK connection classes even though their name is Error', async () => {
    stableJitter();
    const provider = new ScriptedProvider([
      new APIConnectionTimeoutError(),
      new APIConnectionError({ cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }),
      [chunk('recovered'), FINISH],
    ]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'recovered');
    assert.equal(provider.attempts, 3);
  });

  it('retries an SDK stream error without an HTTP status', async () => {
    stableJitter();
    const provider = new ScriptedProvider([
      new APIError(undefined, { code: 'upstream_error' }, 'SSE error', undefined),
      [chunk('ok'), FINISH],
    ]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'ok');
    assert.equal(provider.attempts, 2);
  });

  it('retries a stream that stays open but stops producing chunks', async () => {
    stableJitter();
    const provider = new StallThenSuccessProvider();

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'alive');
    assert.equal(provider.attempts, 2);
  });

  it('bounds a silent first response but honors the configured inter-chunk wait', () => {
    const provider = new ExposedTimeoutProvider({ ...CONFIG, timeoutMs: 120_000 });
    assert.equal(provider.first(), 45_000);
    assert.equal(provider.between(), 120_000);
  });

  it('resets and retries malformed JSON from a real SSE response', async () => {
    let requests = 0;
    const fixture = await listen((_request, response) => {
      requests += 1;
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      if (requests === 1) {
        response.write(`data: ${JSON.stringify(reasoningSnapshot('a'))}\n\n`);
        response.end('data: {"choices": [\n\n');
        return;
      }
      response.write(`data: ${JSON.stringify(chunk('complete'))}\n\n`);
      response.write(`data: ${JSON.stringify(FINISH)}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    mock.method(console, 'error', () => undefined);

    try {
      const provider = new WaitlessHttpProvider({
        ...CONFIG,
        baseURL: fixture.baseURL,
        timeoutMs: 1_000,
      });
      const all = await events(provider.stream(ask));
      assert.deepEqual(all.map((event) => event.kind), [
        'reasoning',
        'reset',
      'retry',
      'text',
      'done',
      ]);
      const replayed = await collect((async function* () {
        for (const event of all) yield event;
      })());
      assert.equal(replayed.reasoning, '');
      assert.equal(replayed.text, 'complete');
      assert.equal(requests, 2);
    } finally {
      await close(fixture.server);
    }
  });

  it('cancels a real SSE wait without retrying', async () => {
    let requests = 0;
    const fixture = await listen((_request, response) => {
      requests += 1;
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      response.write(`data: ${JSON.stringify(reasoningSnapshot('a'))}\n\n`);
    });

    try {
      const controller = new AbortController();
      const provider = new WaitlessHttpProvider({
        ...CONFIG,
        baseURL: fixture.baseURL,
        timeoutMs: 1_000,
      });
      const all: CompletionEvent[] = [];
      for await (const event of provider.stream({ ...ask, signal: controller.signal })) {
        all.push(event);
        if (event.kind === 'reasoning') controller.abort();
      }
      assert.equal(all.at(-1)?.kind, 'done');
      assert.ok(all.at(-1)?.kind === 'done' && all.at(-1)?.reason === 'cancelled');
      assert.equal(all.some((event) => event.kind === 'retry'), false);
      assert.equal(requests, 1);
    } finally {
      await close(fixture.server);
    }
  });

  it('stops immediately when the developer cancels mid-wait', async () => {
    stableJitter();
    const controller = new AbortController();
    const provider = new ScriptedProvider([
      apiError(500, 'Internal server error'),
      apiError(500, 'Internal server error'),
      [chunk('never reached'), FINISH],
    ]);

    const stream = provider.stream({ ...ask, signal: controller.signal });
    const collected: CompletionEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
      if (event.kind === 'retry') controller.abort();
    }

    const last = collected[collected.length - 1];
    assert.equal(last?.kind, 'done');
    assert.ok(last?.kind === 'done' && last.reason === 'cancelled');
  });
});

describe('what is not retried', () => {
  it('does not retry a rejected key', async () => {
    // Ten attempts across four minutes to be told the same thing is worse than
    // being told it now.
    stableJitter();
    const provider = new ScriptedProvider([apiError(401, 'Unauthorized')]);

    await assert.rejects(
      collect(provider.stream(ask)),
      (error: unknown) => PlifError.is(error) && error.code === 'MODEL_AUTH',
    );
    assert.equal(provider.attempts, 1);
  });

  it('does not retry an unknown model', async () => {
    stableJitter();
    const provider = new ScriptedProvider([apiError(404, 'no such model')]);

    await assert.rejects(
      collect(provider.stream(ask)),
      (error: unknown) => PlifError.is(error) && error.code === 'MODEL_NOT_FOUND',
    );
    assert.equal(provider.attempts, 1);
  });
});
