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
import { afterEach, describe, it, mock } from 'node:test';

import { OpenAIProvider } from '../src/model/openai.js';
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

function chunk(content: string): unknown {
  return { choices: [{ delta: { content }, finish_reason: null }] };
}

const FINISH = {
  choices: [{ delta: {}, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
};

/** One scripted attempt: throw, or stream these chunks (an Error ends it). */
type Attempt = Error | readonly unknown[];

class ScriptedProvider extends OpenAIProvider {
  attempts = 0;
  #script: readonly Attempt[];

  constructor(script: readonly Attempt[]) {
    super({ ...CONFIG } as ConstructorParameters<typeof OpenAIProvider>[0]);
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
}

/**
 * Record the backoff instead of sleeping it.
 *
 * Only the long waits are intercepted; anything short belongs to something
 * else and is passed through untouched.
 */
function captureWaits(): number[] {
  const waits: number[] = [];
  const real = globalThis.setTimeout;
  mock.method(globalThis, 'setTimeout', ((handler: () => void, ms?: number, ...rest: unknown[]) => {
    if (typeof ms === 'number' && ms >= 1_000) {
      waits.push(ms);
      return real(handler, 0);
    }
    return real(handler, ms, ...(rest as []));
  }) as typeof setTimeout);
  return waits;
}

async function events(stream: AsyncGenerator<CompletionEvent>): Promise<CompletionEvent[]> {
  const all: CompletionEvent[] = [];
  for await (const event of stream) all.push(event);
  return all;
}

const ask = { messages: [{ role: 'user' as const, content: 'x' }] };

afterEach(() => mock.restoreAll());

describe('retry schedule', () => {
  it('waits 5s, then 10s, then 15s', async () => {
    const waits = captureWaits();
    const provider = new ScriptedProvider([
      apiError(500, 'Internal server error'),
      apiError(500, 'Internal server error'),
      apiError(500, 'Internal server error'),
      [chunk('finally'), FINISH],
    ]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'finally');
    assert.deepEqual(waits, [5_000, 10_000, 15_000]);
  });

  it('announces the attempt before the wait, so the silence is explained', async () => {
    captureWaits();
    const provider = new ScriptedProvider([apiError(503, 'upstream is down'), [chunk('ok'), FINISH]]);

    const all = await events(provider.stream(ask));
    const retry = all.find((event) => event.kind === 'retry');
    assert.ok(retry?.kind === 'retry');
    assert.equal(retry.attempt, 1);
    assert.equal(retry.of, 10);
    assert.equal(retry.waitMs, 5_000);
  });

  it('gives up after ten attempts and says so', async () => {
    captureWaits();
    const provider = new ScriptedProvider(
      Array.from({ length: 14 }, () => apiError(500, 'Internal server error')),
    );

    await assert.rejects(collect(provider.stream(ask)), (error: unknown) => {
      assert.ok(PlifError.is(error));
      assert.match(error.message, /gave up after 10 attempts/);
      return true;
    });
    assert.equal(provider.attempts, 10);
  });

  it('discards a half-delivered turn before redoing it', async () => {
    // The nasty one: the endpoint dies *after* streaming part of the answer.
    // Without a reset the retry's text is appended to the abandoned attempt,
    // and the model is handed both halves back as its own previous turn.
    captureWaits();
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
    captureWaits();
    const provider = new ScriptedProvider([
      [chunk('The answer was cut off')],
      [chunk('The complete answer.'), FINISH],
    ]);

    const result = await collect(provider.stream(ask));
    assert.equal(result.text, 'The complete answer.');
    assert.equal(provider.attempts, 2);
  });

  it('stops immediately when the developer cancels mid-wait', async () => {
    captureWaits();
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
    captureWaits();
    const provider = new ScriptedProvider([apiError(401, 'Unauthorized')]);

    await assert.rejects(
      collect(provider.stream(ask)),
      (error: unknown) => PlifError.is(error) && error.code === 'MODEL_AUTH',
    );
    assert.equal(provider.attempts, 1);
  });

  it('does not retry an unknown model', async () => {
    captureWaits();
    const provider = new ScriptedProvider([apiError(404, 'no such model')]);

    await assert.rejects(
      collect(provider.stream(ask)),
      (error: unknown) => PlifError.is(error) && error.code === 'MODEL_NOT_FOUND',
    );
    assert.equal(provider.attempts, 1);
  });
});
