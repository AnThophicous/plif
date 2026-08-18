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
  adoptProvider,
  credentialVariableForProvider,
  describe as describeConfig,
  isFreeModel,
  keyOptional,
  migrateProviderCredentials,
  redact,
  resolveConfig,
  storedProviderCredentials,
  stripStoredCredentials,
  validate,
} from '../src/model/config.js';
import {
  MODEL_CATALOG,
  catalogSelection,
  findCatalogModel,
  modelVisionBadge,
  rankModelIds,
  userCatalog,
} from '../src/model/catalog.js';
import { EFFORT_LEVELS, forgetProviderKey, supportedEfforts } from '../src/model/config.js';
import { anthropicWireEffort } from '../src/model/anthropic.js';
import { OpenAIProvider } from '../src/model/openai.js';
import { collect } from '../src/model/provider.js';
import { PlifError } from '../src/errors.js';

describe('config precedence', () => {
  it('maps Plif effort to Anthropic maximum effort', () => {
    assert.equal(anthropicWireEffort('plif'), 'max');
    assert.equal(anthropicWireEffort('ultracode'), 'max');
    assert.equal(anthropicWireEffort('high'), 'high');
  });

  it('limits the highest effort levels to the providers that support them', () => {
    assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'ultra', 'ultracode', 'max', 'plif']);
    assert.deepEqual(supportedEfforts(PRESETS.anthropic.baseURL, 'claude-opus-5'), [
      'low', 'medium', 'high', 'xhigh', 'ultracode', 'max', 'plif',
    ]);
    assert.deepEqual(supportedEfforts(PRESETS.openai.baseURL, 'gpt-sol-5.6'), [
      'low', 'medium', 'high', 'xhigh', 'ultra', 'max', 'plif',
    ]);
    assert.deepEqual(supportedEfforts(PRESETS.openai.baseURL, 'gpt-4.1'), [
      'low', 'medium', 'high', 'xhigh', 'max', 'plif',
    ]);
  });

  it('removes a rejected provider credential without touching other providers', () => {
    const next = forgetProviderKey({
      preset: 'nvidia',
      providerKeys: { nvidia: 'stale', openai: 'keep' },
      model: 'z-ai/glm-5.2',
    }, 'nvidia');
    assert.deepEqual(next.providerKeys, { openai: 'keep' });
    assert.equal(next.apiKey, undefined);
  });
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

  it('lets a custom provider own an id that collides with a preset', () => {
    const stored = {
      model: 'openai/custom-model',
      provider: {
        openai: {
          name: 'Company gateway',
          options: { baseURL: 'https://gateway.example.test/v1', apiKey: 'custom-key' },
          models: { 'custom-model': { name: 'Custom model' } },
        },
      },
    };
    const config = resolveConfig(stored, {
      env: {
        OPENAI_API_KEY: 'builtin-key',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
      },
    });
    assert.equal(config.baseURL, 'https://gateway.example.test/v1');
    assert.equal(config.apiKey, 'custom-key');
    assert.equal(credentialVariableForProvider('openai'), 'OPENAI_API_KEY');
    assert.match(
      credentialVariableForProvider('openai', stored),
      /^PLIF_PROVIDER_OPENAI_[A-F0-9]{16}_API_KEY$/,
    );
  });

  it('does not lend a built-in provider key to a colliding custom endpoint', () => {
    const stored = {
      model: 'openai/private-model',
      provider: {
        openai: {
          options: { baseURL: 'https://gateway.example.test/v1', needKey: true },
          models: { 'private-model': { name: 'Private model' } },
        },
      },
    };
    const config = resolveConfig(stored, {
      env: { OPENAI_API_KEY: 'must-not-cross-endpoints' },
    });
    assert.equal(config.baseURL, 'https://gateway.example.test/v1');
    assert.equal(config.apiKey, '');
  });

  it('strips legacy credentials only after callers have collected them', () => {
    const stored = {
      preset: 'openai',
      apiKey: 'root-key',
      providerKeys: { openai: 'provider-key', groq: 'other-key' },
      provider: {
        openai: { options: { baseURL: 'https://gateway.example.test/v1', apiKey: 'custom-key' } },
      },
    };
    assert.deepEqual(storedProviderCredentials(stored), {
      openai: 'custom-key',
      groq: 'other-key',
    });
    const clean = stripStoredCredentials(stored);
    assert.equal(clean.apiKey, undefined);
    assert.equal(clean.providerKeys, undefined);
    assert.equal((clean.provider as { openai?: { options?: { apiKey?: string } } }).openai?.options?.apiKey, undefined);
  });

  it('moves legacy credentials into the vault before returning clean config', async () => {
    const stored = {
      preset: 'nvidia',
      apiKey: 'stale-root-key',
      providerKeys: { nvidia: 'nvidia-key', groq: 'groq-key' },
      provider: {
        private: { options: { baseURL: 'https://private.example.test/v1', apiKey: 'private-key' } },
      },
    };
    const vault = new Map<string, string>([['GROQ_API_KEY', 'newer-groq-key']]);
    const migration = await migrateProviderCredentials(stored, {
      stored: async (variable) => vault.get(variable),
      remember: async (variable, value) => { vault.set(variable, value); },
    });

    assert.equal(migration.migrated, true);
    assert.equal(vault.get('NIM_API_KEY'), 'nvidia-key');
    assert.equal(vault.get('GROQ_API_KEY'), 'newer-groq-key');
    assert.equal(vault.get(credentialVariableForProvider('private', stored)), 'private-key');
    assert.equal(migration.config.apiKey, undefined);
    assert.equal(migration.config.providerKeys, undefined);
    assert.equal(
      (migration.config.provider as { private?: { options?: { apiKey?: string } } }).private?.options?.apiKey,
      undefined,
    );
  });

  it('leaves the source config intact when a vault write fails', async () => {
    const stored = {
      preset: 'nvidia',
      providerKeys: { nvidia: 'nvidia-key', groq: 'groq-key' },
    };
    let writes = 0;
    await assert.rejects(
      migrateProviderCredentials(stored, {
        stored: async () => undefined,
        remember: async () => {
          writes += 1;
          if (writes === 2) throw new Error('vault unavailable');
        },
      }),
      /vault unavailable/,
    );
    assert.deepEqual(stored.providerKeys, { nvidia: 'nvidia-key', groq: 'groq-key' });
  });

  it('keeps normalized custom-provider credential namespaces distinct', () => {
    const stored = {
      provider: {
        'foo-bar': { options: { baseURL: 'https://one.example.test/v1' } },
        foo_bar: { options: { baseURL: 'https://two.example.test/v1' } },
        FOO_BAR: { options: { baseURL: 'https://three.example.test/v1' } },
      },
    };
    const variables = ['foo-bar', 'foo_bar', 'FOO_BAR']
      .map((provider) => credentialVariableForProvider(provider, stored));
    assert.equal(new Set(variables).size, 3);
  });

  it('keeps ambiguous built-in legacy keys away from a colliding custom endpoint', async () => {
    const stored = {
      model: 'openai/private-model',
      apiKey: 'legacy-root-key',
      providerKeys: { openai: 'legacy-provider-key' },
      provider: {
        openai: {
          options: { baseURL: 'https://private.example.test/v1', needKey: true },
          models: { 'private-model': {} },
        },
      },
    };
    assert.equal(resolveConfig(stored, { env: {} }).apiKey, '');

    const vault = new Map<string, string>();
    const migration = await migrateProviderCredentials(stored, {
      stored: async (variable) => vault.get(variable),
      remember: async (variable, value) => { vault.set(variable, value); },
    });

    assert.equal(vault.get('OPENAI_API_KEY'), 'legacy-provider-key');
    assert.equal(vault.get(credentialVariableForProvider('openai', stored)), undefined);
    assert.equal(migration.config.apiKey, undefined);
    assert.equal(migration.config.providerKeys, undefined);
  });

  it('migrates only the winning custom-provider alias', async () => {
    const stored = {
      model: 'private/model',
      providers: {
        private: { options: { baseURL: 'https://loser.example.test/v1', apiKey: 'loser-key' } },
      },
      provider: {
        private: { options: { baseURL: 'https://winner.example.test/v1', apiKey: 'winner-key' } },
      },
    };
    const vault = new Map<string, string>();
    await migrateProviderCredentials(stored, {
      stored: async (variable) => vault.get(variable),
      remember: async (variable, value) => { vault.set(variable, value); },
    });
    assert.equal(vault.get(credentialVariableForProvider('private', stored)), 'winner-key');
    assert.equal(resolveConfig(stored, { env: {} }).baseURL, 'https://winner.example.test/v1');
  });

  it('replaces a local vault sentinel when a real legacy key appears', async () => {
    const stored = { preset: 'nvidia', providerKeys: { nvidia: 'real-key' } };
    const vault = new Map<string, string>([['NIM_API_KEY', 'local']]);
    await migrateProviderCredentials(stored, {
      stored: async (variable) => vault.get(variable),
      remember: async (variable, value) => { vault.set(variable, value); },
    });
    assert.equal(vault.get('NIM_API_KEY'), 'real-key');
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

  it('falls back to the stored file, and to nothing at all after that', () => {
    assert.equal(resolveConfig({ model: 'from-file' }, { env: {} }).model, 'from-file');
    // Plif ships unconfigured on purpose. Resolving nothing must produce no
    // model rather than quietly aiming the agent at somebody's endpoint.
    const config = resolveConfig({}, { env: {} });
    assert.equal(config.model, '');
    const check = validate(config);
    assert.equal(check.ok, false);
    assert.match(check.problem ?? '', /no model/);
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
    const config = resolveConfig({}, { preset: 'ollama', model: 'llama3.1', env: {} });
    assert.equal(config.apiKey, 'local');
    assert.equal(validate(config).ok, true);
  });

  it('does not let a configured local endpoint capture a provider picked later', () => {
    // The bug this guards: root `baseURL`/`apiKey`/`NeedKey` belong to whatever
    // provider was configured when they were written, and used to outrank a
    // preset's own endpoint — so choosing Claude in the TUI posted Claude's
    // model id to a local server on port 9000.
    const stored = {
      preset: 'localbridge',
      baseURL: 'http://127.0.0.1:9000/v1',
      apiKey: 'bridge-secret',
      NeedKey: true,
      provider: {
        localbridge: { options: { baseURL: 'http://127.0.0.1:9000/v1' } },
      },
    };

    const picked = resolveConfig(stored, {
      preset: 'anthropic',
      model: 'claude-opus-5',
      env: {},
    });
    assert.equal(picked.baseURL, PRESETS.anthropic.baseURL);
    assert.equal(picked.apiKey, '', 'the local endpoint key must not travel');

    // Staying on the same provider still honours everything it wrote.
    const same = resolveConfig(stored, { model: 'qwen3-coder', env: {} });
    assert.equal(same.baseURL, 'http://127.0.0.1:9000/v1');
    assert.equal(same.apiKey, 'bridge-secret');
  });

  it('files a root key under its provider when switching away from it', () => {
    const next = adoptProvider(
      {
        preset: 'localbridge',
        baseURL: 'http://127.0.0.1:9000/v1',
        apiKey: 'bridge-secret',
        provider: { localbridge: { options: { baseURL: 'http://127.0.0.1:9000/v1' } } },
      },
      { preset: 'anthropic', model: 'claude-opus-5' },
      'sk-ant-new',
    );

    assert.equal(next.preset, 'anthropic');
    assert.equal(next.model, 'claude-opus-5');
    assert.equal(next.baseURL, undefined, 'the old endpoint must not linger');
    assert.equal(next.apiKey, undefined);
    // Nothing is lost: switching back finds the old key where it belongs.
    assert.deepEqual(next.providerKeys, {
      localbridge: 'bridge-secret',
      anthropic: 'sk-ant-new',
    });
    assert.equal(
      resolveConfig(next, { preset: 'localbridge', model: 'qwen3-coder', env: {} }).apiKey,
      'bridge-secret',
    );
  });

  it('keeps a hand-written base URL when re-picking within one provider', () => {
    const next = adoptProvider(
      { preset: 'openai', baseURL: 'https://gateway.internal/v1' },
      { preset: 'openai', model: 'gpt-4o-mini' },
    );
    assert.equal(next.baseURL, 'https://gateway.internal/v1');
  });

  it('rejects an unknown preset with the list of real ones', () => {
    assert.throws(
      () => resolveConfig({}, { preset: 'nope', env: {} }),
      (error: unknown) =>
        PlifError.is(error) && error.code === 'INVALID_ARGUMENT' && /nope/.test(error.message),
    );
  });

  it('reports a remote endpoint with no key as unusable', () => {
    const config = resolveConfig(
      {},
      { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o', env: {} },
    );
    const check = validate(config);
    assert.equal(check.ok, false);
    assert.match(check.problem ?? '', /API key/);
  });

  it('honours NeedKey for a local model and leaves it actionable', () => {
    const config = resolveConfig(
      { preset: 'ollama', model: 'private-local', NeedKey: true },
      { env: {} },
    );
    assert.equal(config.needKey, true);
    assert.equal(config.apiKey, '');
    const check = validate(config);
    assert.equal(check.ok, false);
    assert.match(check.hint ?? '', /\/models|API_KEY/);
  });

  it('accepts lower camel case needKey for custom local providers', () => {
    const config = resolveConfig({
      model: 'local/private',
      provider: {
        local: {
          options: { baseURL: 'http://127.0.0.1:8790/v1', needKey: true },
          models: { private: { name: 'Private local model' } },
        },
      },
    }, { env: {} });
    assert.equal(config.needKey, true);
    assert.equal(validate(config).ok, false);
  });
});

describe('the free tier needs no credential', () => {
  it('constructs an anonymous OpenCode provider without asking for an API key', () => {
    const provider = new OpenAIProvider({
      model: 'deepseek-v4-flash-free',
      baseURL: PRESETS.opencode.baseURL,
      apiKey: '',
      temperature: 0,
      maxTokens: undefined,
      timeoutMs: 10_000,
    });
    assert.equal(provider.info.id, 'deepseek-v4-flash-free');
  });

  it('recognises the suffix only on a host that serves anonymously', () => {
    assert.equal(isFreeModel('deepseek-v4-flash-free'), true);
    assert.equal(isFreeModel('deepseek-v4-flash'), false);

    assert.equal(keyOptional(PRESETS.opencode.baseURL, 'deepseek-v4-flash-free'), true);
    assert.equal(keyOptional(PRESETS.opencode.baseURL, 'deepseek-v4-flash'), false);
    // The suffix means nothing to a host that does not publish that convention.
    assert.equal(keyOptional('https://api.openai.com/v1', 'something-free'), false);
    assert.equal(keyOptional('http://127.0.0.1:11434/v1', 'llama3.1'), true);
  });

  it('needs no credential once the free tier is explicitly chosen', () => {
    // There is no default any more, so the free tier is something a first-time
    // user picks rather than something they land on.
    const config = resolveConfig(
      {},
      { preset: 'opencode', model: 'deepseek-v4-flash-free', env: {} },
    );
    assert.equal(config.apiKey, '');
    assert.equal(validate(config).ok, true);
  });

  it('leaves the key empty rather than borrowing OPENAI_API_KEY', () => {
    // Zen answers a bare `Bearer` and rejects a key belonging to someone else,
    // so inheriting an unrelated credential is what breaks the free tier.
    const config = resolveConfig({}, {
      preset: 'opencode',
      model: 'deepseek-v4-flash-free',
      env: { OPENAI_API_KEY: 'sk-not-for-this-host' },
    });
    assert.equal(config.apiKey, '');
    assert.equal(validate(config).ok, true);
  });

  it('still uses a key meant for this endpoint when there is one', () => {
    const config = resolveConfig({}, {
      preset: 'opencode',
      model: 'deepseek-v4-flash-free',
      env: { OPENCODE_API_KEY: 'zen-key' },
    });
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
    const shown = describeConfig(
      resolveConfig({}, { preset: 'opencode', model: 'deepseek-v4-flash-free', env: {} }),
    );
    assert.match(shown['key'] ?? '', /not required/);
  });
});

describe('model catalog', () => {
  it('badges no model as the default, because there is no default', () => {
    const badges = MODEL_CATALOG.flatMap((provider) =>
      provider.models.flatMap((model) => model.badges),
    );
    assert.equal(badges.includes('default'), false);
  });

  it('marks every shipped provider as built in', () => {
    assert.ok(MODEL_CATALOG.every((provider) => provider.origin === 'builtin'));
  });

  it('reads the developer own providers out of their config', () => {
    const mine = userCatalog({
      providers: {
        qwenbridge: {
          name: 'Qwen bridge',
          options: { baseURL: 'http://127.0.0.1:9000/v1' },
          models: { 'qwen3-coder': { name: 'Qwen3 Coder', modalities: ['text', 'image'] } },
        },
      },
    });
    assert.equal(mine.length, 1);
    assert.equal(mine[0]?.origin, 'user');
    assert.equal(mine[0]?.label, 'Qwen bridge');
    assert.equal(mine[0]?.models[0]?.id, 'qwen3-coder');
    assert.deepEqual(mine[0]?.models[0]?.modalities, ['text', 'image']);
  });

  it('explains only explicitly declared vision capabilities', () => {
    assert.equal(modelVisionBadge({
      id: 'direct', label: 'Direct', description: '', badges: [], modalities: ['text', 'image'],
    }, false), 'vision');
    assert.equal(modelVisionBadge({
      id: 'text', label: 'Text', description: '', badges: [], modalities: ['text'],
    }, true), 'vision helper');
    assert.equal(modelVisionBadge({
      id: 'text', label: 'Text', description: '', badges: [], modalities: ['text'],
    }, false), 'text only');
    assert.equal(modelVisionBadge({
      id: 'unknown', label: 'Unknown', description: '', badges: [],
    }, true), null);
  });

  it('returns both preset and model for any selection the picker can show', () => {
    assert.deepEqual(catalogSelection('opencode', 'deepseek-v4-flash-free'), {
      preset: 'opencode',
      model: 'deepseek-v4-flash-free',
    });
    // A model discovered from a live endpoint is not in the curated list, and
    // used to be silently unpickable for exactly that reason.
    assert.deepEqual(catalogSelection('nvidia', 'some/newly-added-model'), {
      preset: 'nvidia',
      model: 'some/newly-added-model',
    });
    assert.equal(catalogSelection('', 'model'), null);
  });

  it('ranks curated models first, then free ones, then the rest', () => {
    const ranked = rankModelIds('opencode', [
      'zzz-unknown-paid',
      'aaa-unknown-free',
      'longcat-2.0-free',
      'deepseek-v4-flash-free',
    ]);
    assert.deepEqual(ranked, [
      'deepseek-v4-flash-free',
      'longcat-2.0-free',
      'aaa-unknown-free',
      'zzz-unknown-paid',
    ]);
  });

  it('contains the basic providers in stable display order', () => {
    // Claude leads: it is the provider this agent is tuned against, and the
    // one most people reach for first.
    assert.deepEqual(MODEL_CATALOG.slice(0, 4).map((provider) => provider.id), [
      'anthropic',
      'openai',
      'openrouter',
      'google',
    ]);
    for (const id of ['groq', 'nvidia', 'deepseek', 'zai', 'ollama', 'lmstudio', 'opencode']) {
      assert.ok(MODEL_CATALOG.some((provider) => provider.id === id), `${id} is missing`);
    }
    // Every provider must resolve to a real endpoint, or the picker offers a
    // row that cannot possibly work.
    for (const provider of MODEL_CATALOG) {
      assert.ok(provider.endpoint.startsWith('http'), `${provider.id} has no endpoint`);
    }
  });

  it('ranks NVIDIA GLM 5.2 first with the official NIM model id', () => {
    const nvidia = MODEL_CATALOG.find((provider) => provider.id === 'nvidia');
    assert.equal(nvidia?.models[0]?.id, 'z-ai/glm-5.2');
    assert.equal(nvidia?.models[0]?.label, 'GLM 5.2');
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
