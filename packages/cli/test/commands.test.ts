import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';

import {
  COMMANDS,
  builtInPickerProviders,
  findCommand,
  matchCommands,
  providerModelIds,
  validateEffortArgument,
} from '../src/commands.js';
import type { CommandContext } from '../src/commands.js';
import { entry } from '../src/session.js';
import type { BrowserTab, TimelineEntry } from '../src/session.js';

const mcp = COMMANDS.find((command) => command.name === 'mcp');
const sessions = COMMANDS.find((command) => command.name === 'sessions');
const plan = COMMANDS.find((command) => command.name === 'plan');
const goal = COMMANDS.find((command) => command.name === 'goal');
const effort = COMMANDS.find((command) => command.name === 'effort');

interface Recorder {
  readonly context: CommandContext;
  readonly opened: BrowserTab[];
  readonly logins: string[];
}

function recorder(names: readonly string[] = ['context7', 'github']): Recorder {
  const opened: BrowserTab[] = [];
  const logins: string[] = [];
  const context = {
    openBrowser: (tab: BrowserTab) => {
      opened.push(tab);
    },
    mcpNames: names,
    loginMcp: async (server: string): Promise<TimelineEntry> => {
      logins.push(server);
      return entry('notice', `${server} authenticated`, { tone: 'accent' });
    },
  } as unknown as CommandContext;
  return { context, opened, logins };
}

describe('/mcp', () => {
  it('opens the browser when given nothing', async () => {
    const { context, opened, logins } = recorder();
    const result = await mcp!.run([], context);

    assert.deepEqual(opened, ['mcp']);
    assert.deepEqual(logins, []);
    assert.deepEqual(result.entries, []);
  });

  it('logs in with the server named first', async () => {
    const { context, opened, logins } = recorder();
    const result = await mcp!.run(['context7', 'login'], context);

    assert.deepEqual(logins, ['context7']);
    assert.deepEqual(opened, []);
    assert.match(result.entries[0]?.title ?? '', /context7 authenticated/);
  });

  it('logs in with the verb first, the way every other CLI reads', async () => {
    const { context, logins } = recorder();
    await mcp!.run(['login', 'context7'], context);

    assert.deepEqual(logins, ['context7']);
  });

  it('is not case sensitive about the verb', async () => {
    const { context, logins } = recorder();
    await mcp!.run(['LOGIN', 'github'], context);

    assert.deepEqual(logins, ['github']);
  });

  it('names the servers it knows when no server was given', async () => {
    const { context, logins, opened } = recorder();
    const result = await mcp!.run(['login'], context);

    assert.deepEqual(logins, []);
    assert.deepEqual(opened, [], 'a half-typed command must not open the browser instead');
    assert.match(result.entries[0]?.detail ?? result.entries[0]?.subtitle ?? '', /context7, github/);
  });

  it('says so when nothing is configured to log in to', async () => {
    const { context } = recorder([]);
    const result = await mcp!.run(['login'], context);

    assert.match(result.entries[0]?.subtitle ?? '', /no MCP servers/i);
  });

  it('does not silently browse when the argument makes no sense', async () => {
    const { context, opened, logins } = recorder();
    const result = await mcp!.run(['contect7', 'logn'], context);

    assert.deepEqual(opened, []);
    assert.deepEqual(logins, []);
    assert.match(result.entries[0]?.title ?? '', /does not know/);
  });
});

describe('/sessions', () => {
  it('opens the shared session navigator', async () => {
    const { context, opened } = recorder();
    const result = await sessions!.run([], context);

    assert.deepEqual(opened, ['sessions']);
    assert.deepEqual(result.entries, []);
  });
});

describe('/plan', () => {
  it('enters read-only planning mode and can leave it', async () => {
    const calls: Array<{ enabled: boolean; description?: string }> = [];
    const context = {
      setPlanMode: async (enabled: boolean, description?: string) => {
        calls.push({ enabled, ...(description ? { description } : {}) });
      },
    } as unknown as CommandContext;

    await plan!.run(['map', 'the', 'workspace'], context);
    await plan!.run(['off'], context);

    assert.deepEqual(calls, [
      { enabled: true, description: 'map the workspace' },
      { enabled: false },
    ]);
  });
});

describe('/goal', () => {
  it('sets, reports, and clears a session goal', async () => {
    let current: { condition: string; turns: number; status: string } | null = null;
    const context = {
      startGoal: async (condition: string) => {
        current = { condition, status: 'active' };
      },
      goalStatus: () => current,
      clearGoal: () => {
        current = null;
      },
    } as unknown as CommandContext;

    await goal!.run(['tests', 'pass'], context);
    const status = await goal!.run([], context);
    await goal!.run(['clear'], context);

    assert.match(status.entries[0]?.title ?? '', /goal active: tests pass/);
    assert.equal(current, null);
  });
});

describe('/effort validation', () => {
  it('distinguishes an unknown value from a known unsupported one', () => {
    assert.throws(
      () => validateEffortArgument('banana', ['low', 'medium']),
      (error: unknown) => {
        const typed = error as { message: string; hint?: string };
        assert.equal(typed.message, 'Unknown effort "banana".');
        assert.equal(typed.hint, 'Available: default, low, medium');
        return true;
      },
    );

    assert.throws(
      () => validateEffortArgument('xhigh', ['low', 'medium', 'high']),
      (error: unknown) => {
        const typed = error as { message: string; hint?: string };
        assert.equal(typed.message, 'xhigh is not supported by the current model.');
        assert.equal(typed.hint, 'Supported: low, medium, high');
        return true;
      },
    );
  });

  it('reports that an effort change preserves the current conversation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-effort-command-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');
    const calls: Array<string | undefined> = [];
    try {
      const result = await effort!.run(['high'], {
        supportedEfforts: () => ['low', 'medium', 'high'],
        setEffort: async (value) => { calls.push(value); },
      } as unknown as CommandContext);
      assert.deepEqual(calls, ['high']);
      assert.match(result.entries[0]?.subtitle ?? '', /conversation preserved/);
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('applies /effort plif directly instead of reopening the picker', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-effort-plif-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');
    let opened = 0;
    const calls: Array<string | undefined> = [];
    try {
      const result = await effort!.run(['plif'], {
        supportedEfforts: () => ['low', 'medium', 'high', 'plif'],
        setEffort: async (value) => { calls.push(value); },
        openPicker: () => { opened += 1; },
      } as unknown as CommandContext);
      assert.equal(opened, 0, 'a typed, valid effort must not reopen the picker');
      assert.deepEqual(calls, ['plif']);
      assert.match(result.entries[0]?.title ?? '', /effort\s+PLIF/);
      assert.equal(result.entries[0]?.tone, 'accentBright');
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('applies /models <id> directly and lets the switch report itself', async () => {
    let opened = 0;
    const switched: string[] = [];
    const models = COMMANDS.find((command) => command.name === 'models')!;
    const result = await models.run(['z-ai/glm-5.2'], {
      openPicker: () => { opened += 1; },
      switchModel: async (selection) => { switched.push(String(selection)); },
    } as unknown as CommandContext);

    assert.equal(opened, 0, 'a typed, valid model id must not open the catalog');
    assert.deepEqual(switched, ['z-ai/glm-5.2']);
    assert.equal(result.entries.length, 0);
  });
});

describe('/export', () => {
  it('opens a navigable choice between clipboard and file', async () => {
    let picker: { items?: readonly { value: string }[] } | undefined;
    const context = {
      openPicker: (value: { items?: readonly { value: string }[] }) => { picker = value; },
      copySession: async () => undefined,
      saveSession: async () => undefined,
    } as unknown as CommandContext;

    const exportCommand = COMMANDS.find((command) => command.name === 'export')!;
    const result = await exportCommand.run([], context);

    assert.match(result.entries[0]?.title ?? '', /export session/);
    assert.deepEqual(picker?.items?.map((item) => item.value), ['clipboard', 'file']);
  });
});

describe('provider model picker', () => {
  it('keeps /model and /provider as aliases without duplicate command rows', () => {
    assert.equal(findCommand('model')?.name, 'models');
    assert.equal(findCommand('provider')?.name, 'providers');
    assert.deepEqual(matchCommands('prov').map((command) => command.name), ['providers']);
  });

  it('opens a provider-first picker without probing provider credentials', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-provider-picker-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');
    let picker: { title: string; countLabel?: string; items?: readonly { value: string }[] } | undefined;
    try {
      await findCommand('providers')!.run([], {
        openPicker: (request) => {
          if ('items' in request) picker = request;
        },
      } as unknown as CommandContext);
      assert.equal(picker?.title, 'Select provider');
      assert.equal(picker?.countLabel, 'providers');
      assert.ok(picker?.items?.some((item) => item.value === 'nvidia'));
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('treats a successful provider response as authoritative', () => {
    const catalog = {
      id: 'nvidia',
      label: 'NVIDIA NIM',
      description: 'NVIDIA',
      origin: 'builtin',
      preset: 'nvidia',
      endpoint: 'https://integrate.api.nvidia.com/v1',
      models: [
        { id: 'z-ai/glm-5.2', label: 'GLM 5.2', description: 'Flagship', badges: [] },
      ],
    } as const;

    assert.deepEqual(
      providerModelIds(catalog, ['zai/glm-4.6'], true),
      ['zai/glm-4.6'],
    );
  });

  it('keeps a newly discovered OpenCode free offer without requiring curated metadata', () => {
    const catalog = {
      id: 'opencode',
      label: 'OpenCode Zen',
      description: 'OpenCode',
      origin: 'builtin',
      preset: 'opencode',
      endpoint: 'https://opencode.ai/zen/v1',
      anonymous: true,
      defaultCost: 'free',
      models: [],
    } as const;

    assert.deepEqual(
      providerModelIds(catalog, ['ox-alpha-free'], true, 'free', [{ id: 'ox-alpha-free', name: 'OX Alpha Free' }]),
      ['ox-alpha-free'],
    );
  });

  it('does not duplicate a built-in provider hidden by a custom declaration', () => {
    const custom = [{ id: 'openai' }, { id: 'company' }] as const;
    const builtins = [{ id: 'openai' }, { id: 'anthropic' }] as const;
    assert.deepEqual(
      builtInPickerProviders(custom, builtins).map((provider) => provider.id),
      ['anthropic'],
    );
  });
});
