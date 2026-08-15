import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMANDS, builtInPickerProviders, providerModelIds } from '../src/commands.js';
import type { CommandContext } from '../src/commands.js';
import { entry } from '../src/session.js';
import type { BrowserTab, TimelineEntry } from '../src/session.js';

const mcp = COMMANDS.find((command) => command.name === 'mcp');
const plan = COMMANDS.find((command) => command.name === 'plan');
const goal = COMMANDS.find((command) => command.name === 'goal');

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
  it('keeps NVIDIA GLM 5.2 when live discovery omits it', () => {
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
      ['z-ai/glm-5.2', 'zai/glm-4.6'],
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
