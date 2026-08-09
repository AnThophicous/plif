import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  CredentialBroker,
  MemorySecretStore,
  WindowsDpapiSecretStore,
} from '../src/auth/secrets.js';
import { EventBus } from '../src/events/bus.js';
import { QuestionBroker } from '../src/harness/ask.js';
import { missingMcpCredentials, parseServerConfigs, resolveServerConfigs } from '../src/harness/mcp.js';
import { redactedConfig } from '../src/harness/tools.js';
import type { GlobalConfig } from '../src/config/global.js';

const SECRET = 'sk-live-do-not-print-me';

describe('the configuration the model is allowed to read', () => {
  // get_config is in DEFAULT_TOOLS, so its output lands in the context and is
  // sent to whichever endpoint is serving the model. Anything a credential can
  // hide behind has to be redacted by where it sits, not by what it is called.
  const config = {
    model: 'opencode/deepseek-v4-flash-free',
    provider: {
      house: {
        options: {
          baseURL: 'https://api.example.com/v1',
          apiKey: SECRET,
          headers: { 'X-Tenant': SECRET },
        },
      },
    },
    mcpServers: {
      remote: {
        type: 'http',
        url: 'https://mcp.example.com',
        headers: { Authorization: `Bearer ${SECRET}`, 'X-Trace': 'on' },
      },
      local: {
        command: 'npx',
        args: ['-y', 'server'],
        env: { GH_PAT: SECRET, NODE_ENV: 'production' },
      },
    },
  } as unknown as GlobalConfig;

  it('leaves no credential anywhere in the rendered output', () => {
    const rendered = JSON.stringify(redactedConfig(config));
    assert.equal(rendered.includes(SECRET), false, `secret survived redaction: ${rendered}`);
  });

  it('redacts by location, since a bearer header is not named like a secret', () => {
    const out = redactedConfig(config) as Record<string, any>;
    assert.equal(out['mcpServers']['remote']['headers']['Authorization'], '[redacted]');
    assert.equal(out['mcpServers']['local']['env']['GH_PAT'], '[redacted]');
    assert.equal(out['provider']['house']['options']['headers']['X-Tenant'], '[redacted]');
    assert.equal(out['provider']['house']['options']['apiKey'], '[redacted]');
  });

  it('keeps what the model needs in order to propose a change', () => {
    const out = redactedConfig(config) as Record<string, any>;
    assert.equal(out['model'], 'opencode/deepseek-v4-flash-free');
    assert.equal(out['provider']['house']['options']['baseURL'], 'https://api.example.com/v1');
    assert.equal(out['mcpServers']['remote']['url'], 'https://mcp.example.com');
    assert.equal(out['mcpServers']['local']['command'], 'npx');
  });
});

describe('the credential store', () => {
  it('round-trips a value without writing it in the clear', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-secrets-'));
    const runner = async (_mode: 'protect' | 'unprotect', input: string) =>
      [...input].reverse().join('');
    const store = new WindowsDpapiSecretStore(root, runner);

    await store.set('CONTEXT7_API_KEY', SECRET);

    const files = await fs.readdir(root);
    const disk = await fs.readFile(path.join(root, files[0] as string), 'utf8');
    assert.equal(disk.includes(SECRET), false, 'the value is not on disk in the clear');
    assert.equal(await store.get('CONTEXT7_API_KEY'), SECRET);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('does not name the services someone uses in the file names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-secrets-'));
    const runner = async (_mode: 'protect' | 'unprotect', input: string) =>
      [...input].reverse().join('');
    const store = new WindowsDpapiSecretStore(root, runner);

    await store.set('CONTEXT7_API_KEY', SECRET);

    const files = await fs.readdir(root);
    assert.equal(files.some((file) => file.includes('CONTEXT7')), false);
    assert.deepEqual(await store.names(), ['CONTEXT7_API_KEY'], 'but the record still knows');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('forgets what it is told to forget', async () => {
    const store = new MemorySecretStore({ A: '1' });
    await store.delete('A');
    assert.equal(await store.get('A'), undefined);
  });
});

describe('finding a credential', () => {
  const request = { variable: 'C7_KEY', purpose: 'context7' };

  it('prefers the environment, so a one-off override actually overrides', async () => {
    const asked: string[] = [];
    const broker = new CredentialBroker({
      store: new MemorySecretStore({ C7_KEY: 'stored' }),
      environment: { C7_KEY: 'from-the-shell' },
      prompt: async (item) => {
        asked.push(item.variable);
        return 'typed';
      },
    });

    assert.equal(await broker.resolve(request), 'from-the-shell');
    assert.deepEqual(asked, [], 'nobody was bothered');
  });

  it('falls back to the store before asking', async () => {
    const asked: string[] = [];
    const broker = new CredentialBroker({
      store: new MemorySecretStore({ C7_KEY: SECRET }),
      environment: {},
      prompt: async (item) => {
        asked.push(item.variable);
        return 'typed';
      },
    });

    assert.equal(await broker.resolve(request), SECRET);
    assert.deepEqual(asked, []);
  });

  it('asks once, then saves so the next run does not ask again', async () => {
    const store = new MemorySecretStore();
    let asks = 0;
    const broker = new CredentialBroker({
      store,
      environment: {},
      prompt: async () => {
        asks += 1;
        return SECRET;
      },
    });

    assert.equal(await broker.resolve(request), SECRET);
    assert.equal(await broker.resolve(request), SECRET);
    assert.equal(asks, 1, 'the second read came from the store');
    assert.equal(await store.get('C7_KEY'), SECRET);
  });

  it('does not nag after a refusal', async () => {
    let asks = 0;
    const broker = new CredentialBroker({
      store: new MemorySecretStore(),
      environment: {},
      prompt: async () => {
        asks += 1;
        return null;
      },
    });

    assert.equal(await broker.resolve(request), undefined);
    assert.equal(await broker.resolve(request), undefined);
    assert.equal(asks, 1);
  });

  it('resolves nothing rather than hanging when nobody can be asked', async () => {
    const broker = new CredentialBroker({ store: new MemorySecretStore(), environment: {} });

    assert.equal(broker.interactive, false);
    assert.equal(await broker.resolve(request), undefined);
  });
});

describe('a secret question', () => {
  it('normalizes picker options while preserving their descriptions', async () => {
    const bus = new EventBus();
    let asked: Parameters<Parameters<typeof bus.on<'question.asked'>>[1]>[0] | undefined;
    bus.on('question.asked', (event) => { asked = event; });
    const broker = new QuestionBroker(bus);
    const pending = broker.ask({
      text: 'choose',
      options: [
        'simple',
        { value: 'rich', label: 'Rich choice', description: 'Explains the trade-off.' },
      ],
    });
    assert.deepEqual(asked?.options, [
      { value: 'simple', label: 'simple' },
      { value: 'rich', label: 'Rich choice', description: 'Explains the trade-off.' },
    ]);
    broker.abandonAll();
    await pending;
  });

  it('keeps the value off the bus entirely', async () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on('question.asked', (event) => seen.push(event));
    bus.on('question.answered', (event) => seen.push(event));

    const broker = new QuestionBroker(bus);
    const pending = broker.ask({ text: 'CONTEXT7_API_KEY for context7', secret: true });
    const id = (seen[0] as { id: string }).id;
    broker.answer(id, SECRET);

    assert.equal(await pending, SECRET, 'the caller still gets it');
    assert.equal(JSON.stringify(seen).includes(SECRET), false, 'nothing on the bus carries it');
    assert.equal((seen[0] as { secret?: boolean }).secret, true, 'the interface knows to mask');
    assert.deepEqual(seen[1], { id, answer: null, redacted: true });
  });

  it('still puts an ordinary answer on the bus, which is what it is for', async () => {
    const bus = new EventBus();
    const seen: { id: string; answer: string | null }[] = [];
    bus.on('question.answered', (event) => seen.push(event));

    const broker = new QuestionBroker(bus);
    let asked = '';
    bus.on('question.asked', (event) => (asked = event.id));
    const pending = broker.ask({ text: 'postgres or sqlite?' });
    broker.answer(asked, 'sqlite');

    assert.equal(await pending, 'sqlite');
    assert.equal(seen[0]?.answer, 'sqlite');
  });

  it('separates a redacted answer from a question nobody answered', async () => {
    const bus = new EventBus();
    const seen: { redacted?: boolean; answer: string | null }[] = [];
    bus.on('question.answered', (event) => seen.push(event));

    const broker = new QuestionBroker(bus, 10);
    const pending = broker.ask({ text: 'key?', secret: true });

    assert.equal(await pending, null);
    assert.equal(seen[0]?.answer, null);
    assert.equal(seen[0]?.redacted, undefined, 'a timeout is not a stored credential');
  });
});

describe('filling in an MCP configuration', () => {
  const raw = {
    context7: {
      url: 'https://mcp.context7.test/mcp',
      headers: { Authorization: 'Bearer ${C7_KEY:-}' },
    },
  };

  it('reports which variable is missing and which server wanted it', () => {
    const parsed = parseServerConfigs(raw, {});
    assert.deepEqual(missingMcpCredentials(parsed), [
      { variable: 'C7_KEY', servers: ['context7'] },
    ]);
  });

  it('builds the header once the credential is found', async () => {
    const broker = new CredentialBroker({
      store: new MemorySecretStore({ C7_KEY: SECRET }),
      environment: {},
    });

    const configs = (await resolveServerConfigs(raw, broker, {})) as Record<
      string,
      { headers?: Record<string, string>; unsetVariables?: readonly string[] }
    >;

    assert.equal(configs['context7']?.headers?.['Authorization'], `Bearer ${SECRET}`);
    assert.equal(configs['context7']?.unsetVariables, undefined);
  });

  it('leaves the header off when the credential is nowhere to be found', async () => {
    const broker = new CredentialBroker({ store: new MemorySecretStore(), environment: {} });

    const configs = (await resolveServerConfigs(raw, broker, {})) as Record<
      string,
      { headers?: Record<string, string>; unsetVariables?: readonly string[] }
    >;

    assert.equal(configs['context7']?.headers, undefined);
    assert.deepEqual(configs['context7']?.unsetVariables, ['C7_KEY']);
  });

  it('asks the developer, then wires what they typed into the header', async () => {
    const store = new MemorySecretStore();
    const broker = new CredentialBroker({
      store,
      environment: {},
      prompt: async (item) => {
        assert.equal(item.variable, 'C7_KEY');
        assert.match(item.purpose, /context7/);
        return SECRET;
      },
    });

    const configs = (await resolveServerConfigs(raw, broker, {})) as Record<
      string,
      { headers?: Record<string, string> }
    >;

    assert.equal(configs['context7']?.headers?.['Authorization'], `Bearer ${SECRET}`);
    assert.equal(await store.get('C7_KEY'), SECRET, 'and it is there for next time');
  });
});
