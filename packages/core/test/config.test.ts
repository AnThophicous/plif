import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parse as parseToml } from 'smol-toml';

import {
  CONFIG_SCHEMA_URL,
  activityHudModeOf,
  configSchemaText,
  formatConfigToml,
  globalConfigPath,
  legacyPlifConfigPath,
  loadGlobalConfig,
  migrateLegacyGlobalConfig,
  pendingLegacyGlobalConfigPath,
  removePendingLegacyGlobalConfigs,
  mcpServersOf,
  saveGlobalConfig,
  stripJsonComments,
} from '../src/config/global.js';
import type { GlobalConfig } from '../src/config/global.js';
import { modelSupportsImages, visionCandidates } from '../src/model/config.js';
import { routeVision } from '../src/harness/vision.js';
import { updateConfig } from '../src/harness/tools.js';

const parseJsonc = (source: string): unknown => JSON.parse(stripJsonComments(source));

describe('declared vision providers', () => {
  it('offers only models explicitly declared to support images', () => {
    const candidates = visionCandidates({
      provider: {
        custom: {
          name: 'Custom',
          sdk: 'openai',
          options: { baseURL: 'https://models.example.test/v1' },
          models: {
            plain: { name: 'Plain', modalities: ['text'] },
            vision: { name: 'Vision', modalities: ['text', 'image'] },
          },
        },
      },
    });
    assert.deepEqual(candidates, [
      {
        provider: 'custom',
        model: 'vision',
        label: 'Vision',
        baseURL: 'https://models.example.test/v1',
        cost: 'unknown',
        recommended: false,
      },
    ]);
  });

  it('uses a saved vision model only while that exact configured model exists', () => {
    const provider = {
      custom: {
        options: { baseURL: 'https://models.example.test/v1' },
        models: { vision: { modalities: ['text', 'image'] as const, cost: 'free' as const } },
      },
    };
    assert.equal(routeVision({ provider, visionModel: 'custom/vision' }).kind, 'saved');
    assert.equal(routeVision({ provider, visionModel: 'custom/removed' }).kind, 'select');
  });

  it('allows direct image input only for an explicitly declared active model', () => {
    const config = {
      preset: 'vision-provider',
      model: 'vision-provider/vision',
      provider: {
        'vision-provider': {
          options: { baseURL: 'https://models.example.test/v1' },
          models: {
            plain: { modalities: ['text'] as const },
            vision: { modalities: ['text', 'image'] as const },
          },
        },
      },
    };
    assert.equal(modelSupportsImages(config), true);
    assert.equal(modelSupportsImages({ ...config, model: 'vision-provider/plain' }), false);
    assert.equal(modelSupportsImages({ model: 'opencode/deepseek-v4-flash-free' }), false);
  });

  it('recognizes the explicit built-in vision offer without treating a text model as vision', () => {
    const stored = { model: 'opencode-go/deepseek-v4-flash-vision-exp' };
    assert.equal(modelSupportsImages(stored), true);
    assert.equal(modelSupportsImages({ model: 'opencode-go/qwen3.8-max' }), false);
  });
});

describe('activity HUD preference', () => {
  it('defaults to compact and accepts only persisted HUD modes', () => {
    assert.equal(activityHudModeOf({}), 'compact');
    assert.equal(activityHudModeOf({ activityHud: { mode: 'expanded' } }), 'expanded');
    assert.equal(activityHudModeOf({ activityHud: { mode: 'closed' } }), 'closed');
    assert.equal(activityHudModeOf({ activityHud: { mode: 'invalid' } }), 'compact');
  });

  it('round-trips the presentation preference without creating runtime state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const file = path.join(root, 'config.toml');
    await saveGlobalConfig({ activityHud: { mode: 'expanded' } }, file);

    const read = await loadGlobalConfig(file);
    assert.equal(activityHudModeOf(read), 'expanded');
    assert.match(await fs.readFile(file, 'utf8'), /activityHud/);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('agent configuration writes', () => {
  it('refuses API keys instead of claiming a stripped TOML write succeeded', async () => {
    assert.equal('apiKey' in (updateConfig.spec.parameters.properties ?? {}), false);
    await assert.rejects(
      updateConfig.run({
        operation: 'upsert_provider',
        provider: 'private',
        baseURL: 'https://private.example.test/v1',
        apiKey: 'must-not-enter-a-tool-call',
      }, {} as never),
      /does not accept API keys/,
    );
  });
});

describe('reading a JSONC config', () => {
  it('drops line and block comments', () => {
    assert.deepEqual(
      parseJsonc('{\n  // the model\n  "model": "x", /* inline */ "effort": "high"\n}'),
      { model: 'x', effort: 'high' },
    );
  });

  it('drops a trailing comma, which is the whole point of the c in jsonc', () => {
    assert.deepEqual(parseJsonc('{ "a": 1, "b": [1, 2,], }'), { a: 1, b: [1, 2] });
  });

  it('leaves a comma inside a string alone', () => {
    // The bug this covers: a pass over the finished text rewrote "a, ]" to
    // "a]" — a silent edit to a value nobody asked it to touch.
    assert.deepEqual(parseJsonc('{ "args": ["--filter=a, ]", "b, }"] }'), {
      args: ['--filter=a, ]', 'b, }'],
    });
  });

  it('leaves a comment marker inside a string alone', () => {
    assert.deepEqual(parseJsonc('{ "url": "https://mcp.example.test/mcp" }'), {
      url: 'https://mcp.example.test/mcp',
    });
    assert.deepEqual(parseJsonc('{ "note": "/* not a comment */" }'), { note: '/* not a comment */' });
  });

  it('keeps an escaped quote from ending the string early', () => {
    assert.deepEqual(parseJsonc('{ "q": "say \\", then // stop" }'), { q: 'say ", then // stop' });
  });

  it('preserves line numbers so a parse error still points somewhere useful', () => {
    const source = '{\n// one\n/* two\n   three */\n"a": 1\n}';
    assert.equal(stripJsonComments(source).split('\n').length, source.split('\n').length);
  });
});

describe('the global config file', () => {
  it('uses ~/.plif/config.toml as the only current personal config path', () => {
    assert.equal(globalConfigPath('C:/Users/Plif'), path.join('C:/Users/Plif', '.plif', 'config.toml'));
    assert.equal(legacyPlifConfigPath('C:/Users/Plif'), path.join('C:/Users/Plif', '.plif', 'config.json'));
  });

  it('allows tests and automation to isolate the personal config path', () => {
    const previous = process.env['PLIF_CONFIG_PATH'];
    const isolated = path.resolve('tmp', 'isolated-plif-config.toml');
    process.env['PLIF_CONFIG_PATH'] = isolated;
    try {
      assert.equal(globalConfigPath(), isolated);
      assert.equal(globalConfigPath('C:/Users/Plif'), path.join('C:/Users/Plif', '.plif', 'config.toml'));
    } finally {
      if (previous === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previous;
    }
  });

  it('round-trips an MCP block written with comments and a trailing comma', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const file = path.join(root, 'config.jsonc');
    await fs.writeFile(
      file,
      [
        '{',
        '  // servers I use every day',
        '  "mcp": {',
        '    "context7": {',
        '      "url": "https://mcp.context7.com/mcp",',
        '      "headers": { "Authorization": "${CONTEXT7_API_KEY:-}" },',
        '    },',
        '  },',
        '}',
      ].join('\n'),
      'utf8',
    );

    const config = await loadGlobalConfig(file);
    const servers = mcpServersOf(config) as Record<string, { url: string; headers: unknown }>;

    assert.deepEqual(Object.keys(servers), ['context7']);
    assert.equal(servers['context7']?.url, 'https://mcp.context7.com/mcp');
    assert.deepEqual(servers['context7']?.headers, { Authorization: '${CONTEXT7_API_KEY:-}' });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('treats a missing file as defaults rather than an error', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    assert.deepEqual(await loadGlobalConfig(path.join(root, 'nothing.jsonc')), {});
    await fs.rm(root, { recursive: true, force: true });
  });

  it('refuses a genuinely broken file instead of guessing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const file = path.join(root, 'config.jsonc');
    await fs.writeFile(file, '{ "mcp": { "a": { "url": "x" } ', 'utf8');

    await assert.rejects(loadGlobalConfig(file), /could not be parsed/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes what it can read back', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const file = path.join(root, 'config.toml');
    const config = { model: 'x', mcp: { a: { command: 'node' } } } as GlobalConfig;

    await saveGlobalConfig(config, file);
    const read = await loadGlobalConfig(file);

    assert.equal(read.model, 'x');
    assert.deepEqual(mcpServersOf(read), { a: { command: 'node' } });
    assert.equal(read.$schema, CONFIG_SCHEMA_URL);
    assert.match(await fs.readFile(file, 'utf8'), /config\.schema\.toml/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('renders redacted effective configuration as TOML', () => {
    const rendered = formatConfigToml({
      model: 'local/text-model',
      visionModel: 'local/vision-model',
      permissionMode: 'ask',
    });
    assert.doesNotMatch(rendered, /^\s*\{/);
    assert.deepEqual(parseToml(rendered), {
      model: 'local/text-model',
      visionModel: 'local/vision-model',
      permissionMode: 'ask',
    });
  });

  it('does not re-emit plaintext credentials from a stale config snapshot', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const file = path.join(root, 'config.toml');

    await saveGlobalConfig({
      preset: 'nvidia',
      model: 'z-ai/glm-5.2',
      apiKey: 'root-secret',
      providerKeys: { nvidia: 'secret-key' },
      provider: {
        private: { options: { baseURL: 'https://private.example.test/v1', apiKey: 'nested-secret' } },
      },
    }, file);

    const read = await loadGlobalConfig(file);
    assert.equal(read.apiKey, undefined);
    assert.equal(read.providerKeys, undefined);
    assert.equal(
      (read.provider as { private?: { options?: { apiKey?: string } } }).private?.options?.apiKey,
      undefined,
    );
    assert.doesNotMatch(await fs.readFile(file, 'utf8'), /root-secret|secret-key|nested-secret/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('preserves legacy credentials only when an import opts in explicitly', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const file = path.join(root, 'config.toml');
    await saveGlobalConfig({
      preset: 'nvidia',
      apiKey: 'root-secret',
      providerKeys: { nvidia: 'provider-secret' },
      provider: {
        private: { options: { baseURL: 'https://private.example.test/v1', apiKey: 'nested-secret' } },
      },
    }, file, { preserveProviderKeys: true });

    const read = await loadGlobalConfig(file);
    assert.equal(read.apiKey, 'root-secret');
    assert.deepEqual(read.providerKeys, { nvidia: 'provider-secret' });
    assert.equal(
      (read.provider as { private?: { options?: { apiKey?: string } } }).private?.options?.apiKey,
      'nested-secret',
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it('imports legacy JSONC once and writes a TOML configuration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const legacy = path.join(root, 'legacy.jsonc');
    const target = path.join(root, '.plif', 'config.toml');
    await fs.writeFile(legacy, '{ "model": "local/deepseek", "mcp": { "docs": { "url": "https://mcp.example.test" } } }');

    const config = await migrateLegacyGlobalConfig(target, legacy);
    const toml = await fs.readFile(target, 'utf8');

    assert.equal(config.model, 'local/deepseek');
    assert.match(toml, /model = "local\/deepseek"/);
    assert.equal((await loadGlobalConfig(target)).model, 'local/deepseek');
    await assert.rejects(fs.access(legacy), { code: 'ENOENT' });
    await fs.access(pendingLegacyGlobalConfigPath(legacy));
    await fs.rm(root, { recursive: true, force: true });
  });

  it('keeps imported credentials until the encrypted-store migration can run', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const legacy = path.join(root, 'legacy.jsonc');
    const target = path.join(root, '.plif', 'config.toml');
    await fs.writeFile(legacy, JSON.stringify({
      preset: 'nvidia',
      model: 'z-ai/glm-5.2',
      providerKeys: { nvidia: 'legacy-secret' },
    }));

    await migrateLegacyGlobalConfig(target, legacy);
    assert.deepEqual((await loadGlobalConfig(target)).providerKeys, { nvidia: 'legacy-secret' });
    await assert.rejects(fs.access(legacy), { code: 'ENOENT' });
    await fs.access(pendingLegacyGlobalConfigPath(legacy));
    await fs.rm(root, { recursive: true, force: true });
  });

  it('normalizes a legacy JSON schema URL when migrating to canonical TOML', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-'));
    const legacy = path.join(root, 'legacy.jsonc');
    const target = path.join(root, '.plif', 'config.toml');
    const legacySchemaUrl = CONFIG_SCHEMA_URL.replace(/config\.schema\.toml$/, 'config.schema.json');
    await fs.writeFile(
      legacy,
      JSON.stringify({ $schema: legacySchemaUrl, model: 'local/deepseek' }),
      'utf8',
    );

    await migrateLegacyGlobalConfig(target, legacy);
    const toml = await fs.readFile(target, 'utf8');

    assert.match(toml, /config\.schema\.toml/);
    assert.doesNotMatch(toml, /config\.schema\.json/);
    assert.equal((await loadGlobalConfig(target)).$schema, CONFIG_SCHEMA_URL);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('removes only parked legacy sources after secure migration completes', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-config-home-'));
    const activeLegacy = path.join(home, '.plif', 'config.json');
    const parked = pendingLegacyGlobalConfigPath(activeLegacy);
    await fs.mkdir(path.dirname(activeLegacy), { recursive: true });
    await fs.writeFile(activeLegacy, '{"model":"keep"}', 'utf8');
    await fs.writeFile(parked, '{"apiKey":"remove"}', 'utf8');

    await removePendingLegacyGlobalConfigs(home);

    await fs.access(activeLegacy);
    await assert.rejects(fs.access(parked), { code: 'ENOENT' });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('ships a TOML reference for agent configuration guidance', async () => {
    const schema = await configSchemaText();
    const parsed = parseToml(schema) as Record<string, any>;
    assert.equal(parsed['title'], 'Plif configuration');
    assert.equal(parsed['format'], 'TOML');
    assert.equal(parsed['fields']['model']['type'], 'string');
    assert.deepEqual(parsed['definitions']['model']['fields']['modalities']['values'], ['text', 'image']);
    assert.match(CONFIG_SCHEMA_URL, /config\.schema\.toml$/);
  });
});
