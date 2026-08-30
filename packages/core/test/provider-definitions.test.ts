import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse as parseToml } from 'smol-toml';

import {
  customProviderDefinitionToStored,
  mergeCustomProviderAliases,
  mergeCustomProviderConfig,
  mergeCustomProviderModels,
  normalizeCustomProviderDefinition,
  normalizeStoredCustomProvider,
  ProviderDefinitionError,
  resolveConfig,
  validateCustomProviderDefinition,
} from '../src/model/config.js';
import { formatConfigToml } from '../src/config/global.js';
import type { StoredConfig } from '../src/model/config.js';

describe('declarative custom provider definitions', () => {
  it('normalizes a minimum OpenAI-compatible provider definition', () => {
    const definition = normalizeCustomProviderDefinition({
      id: 'acme-cloud',
      label: 'Acme Cloud',
      baseURL: 'https://api.acme.example/v1/',
      protocol: 'openai-chat',
      defaultModel: 'acme-small',
      models: [{
        id: 'acme-small',
        label: 'Acme Small',
        capabilities: { modalities: ['text'], tools: true },
        contextWindow: 32_768,
        maxOutputTokens: 4_096,
      }],
    });

    assert.equal(definition.id, 'acme-cloud');
    assert.equal(definition.baseURL, 'https://api.acme.example/v1');
    assert.equal(definition.protocol, 'openai-chat');
    assert.equal(definition.auth, 'api-key');
    assert.equal(definition.needKey, true);
    assert.equal(definition.defaultModel, 'acme-small');
    assert.deepEqual(definition.models[0], {
      id: 'acme-small',
      label: 'Acme Small',
      description: '',
      contextWindow: 32_768,
      maxOutputTokens: 4_096,
      modalities: ['text'],
      tools: true,
    });
  });

  it('recognizes a local provider with no key and resolves it without a secret', () => {
    const definition = normalizeCustomProviderDefinition({
      id: 'ollama-local',
      baseURL: 'http://127.0.0.1:11434/v1',
      models: [{ id: 'llama3.1:8b' }],
    });
    const stored = customProviderDefinitionToStored(definition);
    const resolved = resolveConfig({
      provider: { 'ollama-local': stored },
    }, {
      model: 'ollama-local/llama3.1:8b',
      env: {},
    });

    assert.equal(definition.auth, 'none');
    assert.equal(definition.needKey, false);
    assert.equal(resolved.needKey, false);
    assert.equal(resolved.apiKey, 'local');
  });

  it('merges models without erasing saved provider options or metadata', () => {
    const existing = {
      sdk: 'openai' as const,
      name: 'Private gateway',
      options: {
        baseURL: 'https://gateway.example.test/v1',
        needKey: true,
        apiKey: 'must-stay-in-the-legacy-object',
        headers: { 'X-Tenant': 'keep-me' },
      },
      models: {
        old: { name: 'Old model', contextWindow: 16_384, tools: true },
      },
    };

    const merged = mergeCustomProviderModels(existing, [
      { id: 'new', label: 'New model', modalities: ['text'] },
      // An explicit partial update must not reset old metadata that was not
      // mentioned by the caller.
      { id: 'old', label: 'Old model (renamed)' },
    ]);

    assert.notEqual(merged, existing);
    assert.deepEqual(merged.options, existing.options);
    assert.deepEqual(merged.models?.old, {
      name: 'Old model (renamed)',
      contextWindow: 16_384,
      tools: true,
    });
    assert.deepEqual(merged.models?.new, {
      name: 'New model',
      modalities: ['text'],
    });
  });

  it('rejects duplicate model ids with a field-level conflict message', () => {
    assert.throws(
      () => normalizeCustomProviderDefinition({
        id: 'duplicate-check',
        baseURL: 'https://api.example.test/v1',
        models: [{ id: 'same' }, { id: 'same' }],
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderDefinitionError);
        assert.equal(error.path, 'provider.models[1].id');
        assert.match(error.message, /unique model id/i);
        assert.match(error.message, /Example:/);
        assert.doesNotMatch(error.message, /apiKey|secret|token/i);
        return true;
      },
    );
  });

  it('rejects dangerous provider ids and invalid URLs without echoing secrets', () => {
    const dangerousId = validateCustomProviderDefinition({
      id: '../escape',
      baseURL: 'https://api.example.test/v1',
      models: [],
    });
    assert.equal(dangerousId.ok, false);
    if (!dangerousId.ok) {
      assert.equal(dangerousId.error.path, 'provider.id');
      assert.match(dangerousId.error.message, /Example:/);
    }

    const invalidURL = validateCustomProviderDefinition({
      id: 'bad-url',
      baseURL: 'not-a-url?api_key=do-not-print',
      models: [],
    });
    assert.equal(invalidURL.ok, false);
    if (!invalidURL.ok) {
      assert.equal(invalidURL.error.path, 'provider.baseURL');
      assert.match(invalidURL.error.message, /http:\/\/|https:\/\//);
      assert.match(invalidURL.error.message, /Example:/);
      assert.doesNotMatch(invalidURL.error.message, /do-not-print|api_key/i);
    }

    for (const baseURL of [
      'https://user:password@api.example.test/v1',
      'https://api.example.test/v1?api_key=do-not-print',
    ]) {
      const credentialURL = validateCustomProviderDefinition({
        id: 'credential-url',
        baseURL,
        models: [],
      });
      assert.equal(credentialURL.ok, false);
      if (!credentialURL.ok) {
        assert.equal(credentialURL.error.path, 'provider.baseURL');
        assert.doesNotMatch(credentialURL.error.message, /do-not-print|password|user/i);
      }
    }
  });

  it('round-trips the declarative definition through the existing TOML config shape', () => {
    const definition = normalizeCustomProviderDefinition({
      id: 'round-trip',
      label: 'Round Trip',
      description: 'A provider used by the config picker',
      baseURL: 'https://round.example.test/v1',
      protocol: 'anthropic-messages',
      auth: 'api-key',
      needKey: true,
      defaultModel: 'model-v2',
      models: [{
        id: 'model-v2',
        label: 'Model v2',
        description: 'Second generation',
        contextWindow: 131_072,
        modalities: ['text', 'image'],
        reasoning: true,
      }],
    });
    const stored = customProviderDefinitionToStored(definition);
    const serialized = formatConfigToml({ provider: { [definition.id]: stored } });
    const parsed = parseToml(serialized) as StoredConfig;
    const roundTrip = normalizeStoredCustomProvider(
      definition.id,
      (parsed.provider as Record<string, unknown>)[definition.id],
    );

    assert.equal(roundTrip.id, definition.id);
    assert.equal(roundTrip.baseURL, definition.baseURL);
    assert.equal(roundTrip.protocol, definition.protocol);
    assert.equal(roundTrip.auth, definition.auth);
    assert.equal(roundTrip.needKey, true);
    assert.equal(roundTrip.defaultModel, definition.defaultModel);
    assert.deepEqual(roundTrip.models[0], definition.models[0]);
    assert.doesNotMatch(serialized, /apiKey|Authorization/i);
  });

  it('unifies legacy providers/providers aliases and canonicalizes a merged config', () => {
    const aliases = mergeCustomProviderAliases(
      {
        bridge: {
          name: 'Legacy name',
          options: { baseURL: 'https://old.example.test/v1', needKey: true },
          models: { old: { name: 'Old' } },
        },
      },
      {
        bridge: {
          name: 'Canonical name',
          options: { baseURL: 'https://new.example.test/v1' },
          models: { new: { name: 'New' } },
        },
      },
    );
    assert.equal(aliases.bridge?.name, 'Canonical name');
    assert.equal(aliases.bridge?.options?.baseURL, 'https://new.example.test/v1');
    assert.equal(aliases.bridge?.options?.needKey, true);
    assert.deepEqual(Object.keys(aliases.bridge?.models ?? {}).sort(), ['new', 'old']);

    const next = mergeCustomProviderConfig({
      providers: aliases,
      provider: { bridge: aliases.bridge },
    }, {
      id: 'bridge',
      baseURL: 'https://new.example.test/v1',
      models: [{ id: 'latest' }],
    });
    assert.equal(next.providers, undefined);
    assert.deepEqual(Object.keys((next.provider as Record<string, { models?: Record<string, unknown> }>).bridge?.models ?? {}).sort(), ['latest', 'new', 'old']);
  });
});
