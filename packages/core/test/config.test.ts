import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  loadGlobalConfig,
  mcpServersOf,
  saveGlobalConfig,
  stripJsonComments,
} from '../src/config/global.js';
import type { GlobalConfig } from '../src/config/global.js';
import { visionCandidates } from '../src/model/config.js';
import { routeVision } from '../src/harness/vision.js';

const parse = (source: string): unknown => JSON.parse(stripJsonComments(source));

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
});

describe('reading a JSONC config', () => {
  it('drops line and block comments', () => {
    assert.deepEqual(
      parse('{\n  // the model\n  "model": "x", /* inline */ "effort": "high"\n}'),
      { model: 'x', effort: 'high' },
    );
  });

  it('drops a trailing comma, which is the whole point of the c in jsonc', () => {
    assert.deepEqual(parse('{ "a": 1, "b": [1, 2,], }'), { a: 1, b: [1, 2] });
  });

  it('leaves a comma inside a string alone', () => {
    // The bug this covers: a pass over the finished text rewrote "a, ]" to
    // "a]" — a silent edit to a value nobody asked it to touch.
    assert.deepEqual(parse('{ "args": ["--filter=a, ]", "b, }"] }'), {
      args: ['--filter=a, ]', 'b, }'],
    });
  });

  it('leaves a comment marker inside a string alone', () => {
    assert.deepEqual(parse('{ "url": "https://mcp.example.test/mcp" }'), {
      url: 'https://mcp.example.test/mcp',
    });
    assert.deepEqual(parse('{ "note": "/* not a comment */" }'), { note: '/* not a comment */' });
  });

  it('keeps an escaped quote from ending the string early', () => {
    assert.deepEqual(parse('{ "q": "say \\", then // stop" }'), { q: 'say ", then // stop' });
  });

  it('preserves line numbers so a parse error still points somewhere useful', () => {
    const source = '{\n// one\n/* two\n   three */\n"a": 1\n}';
    assert.equal(stripJsonComments(source).split('\n').length, source.split('\n').length);
  });
});

describe('the global config file', () => {
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
    const file = path.join(root, 'config.jsonc');
    const config = { model: 'x', mcp: { a: { command: 'node' } } } as GlobalConfig;

    await saveGlobalConfig(config, file);
    const read = await loadGlobalConfig(file);

    assert.equal(read.model, 'x');
    assert.deepEqual(mcpServersOf(read), { a: { command: 'node' } });
    await fs.rm(root, { recursive: true, force: true });
  });
});
