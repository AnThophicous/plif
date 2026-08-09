/**
 * Model configuration and the OpenAI-compatible provider.
 *
 * Two areas get tested, for different reasons.
 *
 * **Config resolution** because precedence bugs are silent: the wrong key or
 * the wrong endpoint gets picked up and the failure surfaces much later as an
 * auth error against a service the user did not think they were calling.
 *
 * **Streamed tool-call reassembly** because the wire format delivers a call in
 * fragments — a name in one chunk, arguments split across several more — and a
 * caller handed half-parsed JSON has no way to recover. This is the one piece
 * of real logic in the provider; everything else is transport the SDK owns.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import {
  PRESETS,
  describe as describeConfig,
  isFreeModel,
  keyOptional,
  redact,
  resolveConfig,
  validate,
} from '../src/model/config.js';
import {
  MODEL_CATALOG,
  MODEL_CATALOG_DEFAULT,
  catalogSelection,
  findCatalogModel,
} from '../src/model/catalog.js';
import { OpenAIProvider } from '../src/model/openai.js';
import { collect } from '../src/model/provider.js';
import { PlifError } from '../src/errors.js';

describe('config precedence', () => {
  it('resolves an OpenCode-style custom provider and qualified model', () => {
    const config = resolveConfig({
      model: 'al-local/al-thinking',
      provider: {
        'al-local': {
          npm: '@ai-sdk/openai',
          name: 'AL Local',
          options: { baseURL: 'http://127.0.0.1:4000/v1', apiKey: 'local' },
          models: { 'al-thinking': { name: 'AL Thinking' } },
        },
      },
    }, { env: {} });

    assert.equal(config.model, 'al-thinking');
    assert.equal(config.baseURL, 'http://127.0.0.1:4000/v1');
    assert.equal(config.apiKey, 'local');
  });

  it('lets an explicit option beat the environment', () => {
    const config = resolveConfig(
      { model: 'from-file' },
      { model: 'from-flag', env: { PLIF_MODEL: 'from-env' } },
    );
    assert.equal(config.model, 'from-flag');
  });

  it('lets the environment beat the stored file', () => {
    // A shell override must work for one run without editing anything on disk.
    const config = resolveConfig({ model: 'from-file' }, { env: { PLIF_MODEL: 'from-env' } });
    assert.equal(config.model, 'from-env');
  });

  it('falls back to the stored file, then to the default', () => {
    assert.equal(resolveConfig({ model: 'from-file' }, { env: {} }).model, 'from-file');
    const config = resolveConfig({}, { env: {} });
    assert.equal(config.model, 'deepseek-v4-flash-free');
    assert.equal(config.baseURL, PRESETS.opencode.baseURL);
  });

  it('prefers the preset own key variable over the generic one', () => {
    // Switching preset should pick up the right credential without renaming.
    const config = resolveConfig(
      {},
      { preset: 'groq', env: { GROQ_API_KEY: 'groq-key', OPENAI_API_KEY: 'openai-key' } },
    );
    assert.equal(config.apiKey, 'groq-key');
    assert.equal(config.baseURL, PRESETS['groq']!.baseURL);
  });

  it('supplies a placeholder key for local endpoints', () => {
    // Ollama and LM Studio ignore the value, but the SDK refuses an empty one.
    const config = resolveConfig({}, { preset: 'ollama', env: {} });
    assert.equal(config.apiKey, 'local');
    assert.equal(validate(config).ok, true);
  });

  it('rejects an unknown preset with the list of real ones', () => {
    assert.throws(
      () => resolveConfig({}, { preset: 'nope', env: {} }),
      (error: unknown) =>
        PlifError.is(error) && error.code === 'INVALID_ARGUMENT' && /nope/.test(error.message),
    );
  });

  it('reports a remote endpoint with no key as unusable', () => {
    const config = resolveConfig({}, { baseURL: 'https://api.openai.com/v1', env: {} });
    const check = validate(config);
    assert.equal(check.ok, false);
    assert.match(check.problem ?? '', /API key/);
  });
});

describe('the free tier needs no credential', () => {
  it('recognises the suffix only on a host that serves anonymously', () => {
    assert.equal(isFreeModel('deepseek-v4-flash-free'), true);
    assert.equal(isFreeModel('deepseek-v4-flash'), false);

    assert.equal(keyOptional(PRESETS.opencode.baseURL, 'deepseek-v4-flash-free'), true);
    assert.equal(keyOptional(PRESETS.opencode.baseURL, 'deepseek-v4-flash'), false);
    // The suffix means nothing to a host that does not publish that convention.
    assert.equal(keyOptional('https://api.openai.com/v1', 'something-free'), false);
    assert.equal(keyOptional('http://127.0.0.1:11434/v1', 'llama3.1'), true);
  });

  it('runs the default configuration with nothing set at all', () => {
    // What a first-time user has: no config file, no environment.
    const config = resolveConfig({}, { env: {} });
    assert.equal(config.apiKey, '');
    assert.equal(validate(config).ok, true);
  });

  it('leaves the key empty rather than borrowing OPENAI_API_KEY', () => {
    // Zen answers a bare `Bearer` and rejects a key belonging to someone else,
    // so inheriting an unrelated credential is what breaks the free tier.
    const config = resolveConfig({}, { env: { OPENAI_API_KEY: 'sk-not-for-this-host' } });
    assert.equal(config.apiKey, '');
    assert.equal(validate(config).ok, true);
  });

  it('still uses a key meant for this endpoint when there is one', () => {
    const config = resolveConfig({}, { env: { OPENCODE_API_KEY: 'zen-key' } });
    assert.equal(config.apiKey, 'zen-key');
  });

  it('still demands a key for the paid sibling of a free model', () => {
    const config = resolveConfig({ model: 'deepseek-v4-flash' }, { env: {} });
    assert.equal(validate(config).ok, false);
  });

  it('lets every model the catalog badges "no key" be picked with none', () => {
    // What /model does when a row is chosen. A badge promising no credential
    // on a model the validator then refuses is the exact bug this guards.
    const zen = MODEL_CATALOG.find((entry) => entry.id === 'opencode');
    const free = zen?.models.filter((entry) => entry.badges.includes('no key')) ?? [];
    assert.ok(free.length > 1, 'the free tier should offer a choice, not one model');

    for (const candidate of free) {
      const config = resolveConfig({}, { preset: 'opencode', model: candidate.id, env: {} });
      assert.equal(validate(config).ok, true, `${candidate.id} should need no key`);
    }
  });

  it('says the key is not required instead of showing it as missing', () => {
    const shown = describeConfig(resolveConfig({}, { env: {} }));
    assert.match(shown['key'] ?? '', /not required/);
  });
});

describe('model catalog', () => {
  it('keeps OpenCode first and exposes the default model', () => {
    assert.equal(MODEL_CATALOG[0]?.id, 'opencode');
    assert.equal(MODEL_CATALOG_DEFAULT.provider, 'opencode');
    assert.equal(MODEL_CATALOG_DEFAULT.model, 'deepseek-v4-flash-free');
    assert.equal(
      findCatalogModel('opencode', 'deepseek-v4-flash-free')?.badges.includes('default'),
      true,
    );
  });

  it('returns both preset and model for a catalog selection', () => {
    assert.deepEqual(catalogSelection('opencode', 'deepseek-v4-flash-free'), {
      preset: 'opencode',
      model: 'deepseek-v4-flash-free',
    });
    assert.equal(catalogSelection('missing', 'model'), null);
  });

  it('contains the basic providers in stable display order', () => {
    assert.deepEqual(MODEL_CATALOG.map((provider) => provider.id), [
      'opencode',
      'openrouter',
      'openai',
      'ollama',
      'lmstudio',
      'groq',
      'deepseek',
      'together',
    ]);
  });
});

describe('secret handling', () => {
  it('never returns the key from describe()', () => {
    const config = resolveConfig({}, { apiKey: 'sk-verysecretvalue12345', env: {} });
    const shown = JSON.stringify(describeConfig(config));

    assert.equal(shown.includes('verysecret'), false);
    assert.equal(shown.includes('sk-verysecretvalue12345'), false);
  });

  it('redacts to a shape, so a wrong key is distinguishable from no key', () => {
    assert.equal(redact(''), '(none)');
    assert.equal(redact('local'), '(not required — local endpoint)');
    assert.match(redact('sk-abcdefghijklmnop'), /^sk-…mnop \(\d+ chars\)$/);
  });
});

// ---------------------------------------------------------------------------

/** A server that streams SSE the way an OpenAI-compatible endpoint does. */
function fakeEndpoint(handler: (body: Record<string, unknown>, send: (chunk: unknown) => void) => void) {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (chunk: unknown): void => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };
      handler(JSON.parse(raw || '{}') as Record<string, unknown>, send);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
}

describe('streaming', () => {
  let server: http.Server;
  let baseURL: string;

  before(async () => {
    server = fakeEndpoint((body, send) => {
      const base = { id: 'x', object: 'chat.completion.chunk', model: body['model'] };

      if (Array.isArray(body['tools']) && body['tools'].length > 0) {
        // The name arrives alone; the arguments arrive as a stream of slices.
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'run_command' } }] },
            },
          ],
        });
        for (const piece of ['{"cmd"', ':"npm ', 'test"}']) {
          send({
            ...base,
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] } },
            ],
          });
        }
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        for (const piece of ['hello ', 'from ', 'the model']) {
          send({ ...base, choices: [{ index: 0, delta: { content: piece } }] });
        }
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      send({ ...base, choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const provider = (): OpenAIProvider =>
    new OpenAIProvider({
      model: 'fake',
      baseURL,
      apiKey: 'test',
      temperature: 0,
      maxTokens: undefined,
      timeoutMs: 10_000,
    });

  it('emits text as deltas, not as one blob at the end', async () => {
    const deltas: string[] = [];
    for await (const event of provider().stream({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      if (event.kind === 'text') deltas.push(event.delta);
    }
    assert.ok(deltas.length > 1, 'expected several deltas, got one blob');
    assert.equal(deltas.join(''), 'hello from the model');
  });

  it('reports usage and a finish reason', async () => {
    const result = await collect(
      provider().stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    assert.equal(result.reason, 'stop');
    assert.equal(result.usage.promptTokens, 11);
    assert.equal(result.usage.completionTokens, 7);
  });

  it('sends complete text and image attachments as ordered content parts', async () => {
    let received: Record<string, unknown> | undefined;
    const capture = fakeEndpoint((body, send) => {
      received = body;
      send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    });
    await new Promise<void>((resolve) => capture.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(capture.address() as AddressInfo).port}/v1`;
    const captured = new OpenAIProvider({ model: 'fake', baseURL: endpoint, apiKey: 'test', temperature: 0, maxTokens: undefined, timeoutMs: 10_000 });
    await collect(captured.stream({ messages: [{ role: 'user', content: 'See [Pasted Content #1 - 2 Lines]', attachments: [
      { kind: 'text', name: '[Pasted Content #1 - 2 Lines]', text: 'one\ntwo' },
      { kind: 'image', name: '[Pasted Content #2 - 0 Lines]', mediaType: 'image/png', data: 'AQI=' },
    ] }] }));
    await new Promise<void>((resolve) => capture.close(() => resolve()));
    const message = (received?.['messages'] as Array<Record<string, unknown>>)[0];
    assert.deepEqual(message?.['content'], [
      { type: 'text', text: 'See [Pasted Content #1 - 2 Lines]' },
      { type: 'text', text: 'one\ntwo' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQI=' } },
    ]);
  });

  it('sanitizes malformed assistant tool arguments before sending', async () => {
    let received: Record<string, unknown> | undefined;
    const capture = fakeEndpoint((body, send) => {
      received = body;
      send({ id: 'x', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    });
    await new Promise<void>((resolve) => capture.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(capture.address() as AddressInfo).port}/v1`;
    const captured = new OpenAIProvider({ model: 'fake', baseURL: endpoint, apiKey: 'test', temperature: 0, maxTokens: undefined, timeoutMs: 10_000 });

    await collect(captured.stream({
      messages: [{
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'bad-1', name: 'run_command', arguments: '{"argv":' }],
      }],
    }));
    await new Promise<void>((resolve) => capture.close(() => resolve()));

    const message = (received?.['messages'] as Array<Record<string, unknown>>)[0];
    const calls = message?.['tool_calls'] as Array<Record<string, unknown>>;
    const fn = calls[0]?.['function'] as Record<string, unknown>;
    assert.equal(calls[0]?.['id'], 'bad-1');
    assert.equal(fn['name'], 'run_command');
    assert.equal(fn['arguments'], '{}');
  });

  it('reassembles a tool call split across fragments', async () => {
    const result = await collect(
      provider().stream({
        messages: [{ role: 'user', content: 'run the tests' }],
        tools: [
          {
            name: 'run_command',
            description: 'run a shell command',
            parameters: { type: 'object', properties: { cmd: { type: 'string' } } },
          },
        ],
      }),
    );

    assert.equal(result.reason, 'tool_calls');
    assert.equal(result.toolCalls.length, 1);

    const call = result.toolCalls[0]!;
    assert.equal(call.name, 'run_command');
    assert.equal(call.id, 'call_1');
    // The whole point: arguments must be valid JSON by the time we hand them on.
    assert.deepEqual(JSON.parse(call.arguments), { cmd: 'npm test' });
  });

  it('emits tool calls only after the stream completes', async () => {
    // A tool event arriving before `done` would mean the arguments were still
    // being assembled, which is exactly the bug this ordering prevents.
    const order: string[] = [];
    for await (const event of provider().stream({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'run_command', description: 'x', parameters: {} }],
    })) {
      order.push(event.kind);
    }
    assert.deepEqual(order, ['tool', 'done']);
  });
});

describe('error translation', () => {
  let server: http.Server;
  let baseURL: string;

  before(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid key' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('turns a 401 into an actionable MODEL_AUTH, not a bare status code', async () => {
    const provider = new OpenAIProvider({
      model: 'fake',
      baseURL,
      apiKey: 'bad',
      temperature: 0,
      maxTokens: undefined,
      timeoutMs: 5_000,
    });

    await assert.rejects(
      () => collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
      (error: unknown) => {
        assert.ok(PlifError.is(error));
        assert.equal(error.code, 'MODEL_AUTH');
        assert.match(error.hint ?? '', /key/i);
        return true;
      },
    );
  });

  it('does not mark an auth failure as retryable', async () => {
    // A bad key never fixes itself. Retrying it just burns the rate limit.
    const error = new PlifError('MODEL_AUTH', 'nope');
    assert.equal(PlifError.isTransient(error), false);
    assert.equal(PlifError.isTransient(new PlifError('MODEL_RATE_LIMIT', 'slow down')), true);
  });
});
