import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveGlobalConfig, tokenSplitDefinitions } from '@plif/core';

import {
  COMMANDS,
  AGENT_SUBCOMMANDS,
  BUILTIN_AGENT_PRESETS,
  builtInPickerProviders,
  findCommand,
  mergeDiscoveredModel,
  normalizeAgentAction,
  matchCommands,
  providerModelIds,
  validateEffortArgument,
} from '../src/commands.js';
import { findCatalogProvider } from '@plif/core';
import type { ProviderModel } from '@plif/core';
import type { CommandContext } from '../src/commands.js';
import { entry } from '../src/session.js';
import type { BrowserTab, TimelineEntry } from '../src/session.js';

async function fakeCodexCommand(root: string): Promise<string> {
  const fixture = fileURLToPath(new URL('../../core/test/fixtures/fake-codex-app-server.mjs', import.meta.url));
  const command = path.join(root, process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex');
  if (process.platform === 'win32') {
    await fs.writeFile(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, 'utf8');
  } else {
    await fs.writeFile(command, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, 'utf8');
    await fs.chmod(command, 0o755);
  }
  return command;
}

const mcp = COMMANDS.find((command) => command.name === 'mcp');
const sessions = COMMANDS.find((command) => command.name === 'sessions');
const plan = COMMANDS.find((command) => command.name === 'plan');
const goal = COMMANDS.find((command) => command.name === 'goal');
const effort = COMMANDS.find((command) => command.name === 'effort');
const persona = COMMANDS.find((command) => command.name === 'persona');
const usage = COMMANDS.find((command) => command.name === 'usage');
const temp = COMMANDS.find((command) => command.name === 'temp');

describe('/temp session scratch space', () => {
  it('explains the isolated virtual path without exposing the host path', async () => {
    const hostPath = path.join(os.tmpdir(), 'plif-session-private');
    const result = await temp!.run([], { tempDir: hostPath } as unknown as CommandContext);
    const rendered = `${result.entries[0]?.title}\n${result.entries[0]?.subtitle}\n${result.entries[0]?.detail}`;
    assert.match(rendered, /\/temp/);
    assert.match(rendered, /isolated from \/project/);
    assert.doesNotMatch(rendered, new RegExp(hostPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

describe('/token-split picker', () => {
  it('opens a navigable method picker with explicit active and inactive states', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-token-split-list-'));
    const opened: Array<{
      title: string;
      hint?: string;
      countLabel?: string;
      items: readonly { value: string; state?: string; current?: boolean }[];
      onPick: (value: string) => void;
    }> = [];
    try {
      const result = await findCommand('token-split')!.run([], {
        cwd: root,
        openPicker: (request) => {
          if ('items' in request) opened.push(request as typeof opened[number]);
        },
      } as unknown as CommandContext);
      assert.equal(result.entries.length, 0);
      assert.equal(opened[0]?.countLabel, 'methods');
      assert.match(opened[0]?.title ?? '', /TOKEN SPLIT · ✓/);
      assert.match(opened[0]?.hint ?? '', /Enter activate\/remove/);
      assert.match(opened[0]?.hint ?? '', /✓ active · × inactive/);
      assert.equal(opened[0]?.items.length, tokenSplitDefinitions().length);
      for (const definition of tokenSplitDefinitions()) {
        const item = opened[0]?.items.find((candidate) => candidate.value === definition.id);
        assert.ok(item);
        assert.equal(item.state, item.current ? 'on' : 'off');
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('keeps machine-readable list output behind --json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-token-split-json-'));
    try {
      const result = await findCommand('token-split')!.run(['list', '--json'], { cwd: root } as unknown as CommandContext);
      const listed = result.entries[0];
      assert.ok(listed);
      assert.equal(listed.expand, true);
      assert.match(`${listed.title}\n${listed.detail ?? ''}`, /"techniques"/);
      for (const definition of tokenSplitDefinitions()) {
        assert.match(listed.detail ?? listed.title, new RegExp(`"id": "${definition.id}"`));
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('toggles a selected method and reports the result after the picker closes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-token-split-toggle-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    const configPath = path.join(root, 'config.toml');
    process.env['PLIF_CONFIG_PATH'] = configPath;
    await fs.writeFile(configPath, '');
    let onPick: ((value: string) => void | Promise<void>) | undefined;
    const notices: TimelineEntry[] = [];
    try {
      await findCommand('token-split')!.run([], {
        openPicker: (request) => {
          if ('items' in request) onPick = (value) => request.onPick(value);
        },
        notify: (notice) => notices.push(notice),
        engine: { questions: { ask: async () => 'enable' } },
      } as unknown as CommandContext);

      await onPick?.('compaction');

      const persisted = JSON.parse(await fs.readFile(path.join(root, 'token-split.json'), 'utf8')) as {
        techniques: { compaction: { on: boolean } };
      };
      assert.equal(persisted.techniques.compaction.on, true);
      assert.equal(notices[0]?.tone, 'success');
      assert.match(notices[0]?.title ?? '', /compaction/);
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe('/agents command navigation', () => {
  it('uses /agents as the canonical command and accepts the singular alias', () => {
    assert.equal(findCommand('agents')?.name, 'agents');
    assert.equal(findCommand('agent')?.name, 'agents');
    assert.deepEqual(
      findCommand('agents')?.autocomplete?.getValues?.({ argumentIndex: 0 } as never),
      ['menu'],
    );
    assert.equal(
      findCommand('agents')?.autocomplete?.getLabel?.('menu', {} as never),
      'Abrir menu',
    );
    assert.deepEqual(normalizeAgentAction('a'), 'add');
    assert.deepEqual(normalizeAgentAction('r'), 'remove');
    assert.deepEqual(normalizeAgentAction('rn'), 'rename');
    assert.deepEqual(normalizeAgentAction('l'), 'list');
  });

  it('keeps short tab targets for the guided menu', () => {
    assert.deepEqual(AGENT_SUBCOMMANDS, ['add', 'remove', 'rename', 'list', 'auto']);
    assert.deepEqual(
      BUILTIN_AGENT_PRESETS.map((preset) => preset.name),
      ['CEO - Pli\'ef', 'Diretor de Criação - Pli\'ef', 'The Critic - Pli\'ef', 'The Simulator - Pli\'ef'],
    );
    assert.ok(BUILTIN_AGENT_PRESETS.every((preset) => preset.instructions.length > 1000));
  });

  it('opens the guided action menu instead of requiring a model id', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-agents-command-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');
    const opened: Array<{ title: string; hint?: string; items: readonly { value: string }[] }> = [];
    const context = {
      openPicker: (request: { title: string; hint?: string; items: readonly { value: string }[] }) => opened.push(request),
    } as unknown as CommandContext;
    try {
      await findCommand('agents')!.run([], context);
      assert.equal(opened[0]?.title, 'Agents');
      assert.deepEqual(opened[0]?.items.map((item) => item.value), ['add', 'remove', 'rename', 'list', 'auto']);

      await findCommand('agents')!.run(['a'], context);
      assert.equal(opened[1]?.title, 'Add agent');
      assert.deepEqual(opened[1]?.items.map((item) => item.value), ['custom']);
      assert.match(opened[1]?.hint ?? '', /already in List/i);

      await findCommand('agents')!.run(['list'], context);
      assert.deepEqual(
        opened[2]?.items.map((item) => item.value),
        ['CEO - Pli\'ef', 'Diretor de Criação - Pli\'ef', 'The Critic - Pli\'ef', 'The Simulator - Pli\'ef'],
      );
      assert.match(opened[2]?.hint ?? '', /AUTO-LAUNCH ✓/);

      const status = await findCommand('agents')!.run(['auto', 'show'], context);
      assert.match(status.entries[0]?.title ?? '', /AUTO-LAUNCH ✓/);
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe('/persona persistent behavior layer', () => {
  it('opens a creation menu instead of stopping at an empty-state message', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-persona-menu-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');
    const opened: Array<{ title: string; hint?: string; items: readonly { value: string }[] }> = [];
    try {
      await persona!.run([], {
        openPicker: (request) => {
          if ('items' in request) opened.push(request);
        },
      } as unknown as CommandContext);
      assert.equal(opened[0]?.title, 'Personas');
      assert.deepEqual(opened[0]?.items.map((item) => item.value), ['add', 'list', 'show', 'off']);
      assert.match(opened[0]?.hint ?? '', /no active persona/);
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('creates and persists a persona through the guided add flow', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-persona-add-'));
    const file = path.join(root, 'config.toml');
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = file;
    await fs.writeFile(file, '');
    const answers = ['reviewer', 'Correctness-focused review persona.', 'Review correctness before style.'];
    try {
      const result = await persona!.run(['add'], {
        engine: { questions: { ask: async () => answers.shift() ?? null } },
        model: { info: { id: 'deepseek-v4-flash-free' } },
      } as unknown as CommandContext);
      const saved = await import('@plif/core').then(({ loadGlobalConfig, profilesOf }) => loadGlobalConfig(file).then((config) => profilesOf(config)));
      assert.equal(saved.reviewer?.description, 'Correctness-focused review persona.');
      assert.equal(saved.reviewer?.systemPrompt, 'Review correctness before style.');
      assert.equal(saved.reviewer?.model, 'deepseek-v4-flash-free');
      assert.match(result.entries[0]?.title ?? '', /persona reviewer saved/);
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('lists, activates, shows, and disables a saved persona without replacing PLIF identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-persona-command-'));
    const file = path.join(root, 'config.toml');
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = file;
    await saveGlobalConfig({
      model: 'opencode/deepseek-v4-flash-free',
      profiles: {
        reviewer: {
          name: 'Reviewer',
          description: 'Correctness-focused review persona.',
          model: 'opencode/deepseek-v4-flash-free',
          systemPrompt: 'Review correctness before style.',
        },
      },
      activeProfile: 'reviewer',
    }, file);
    const switched: string[] = [];
    const cleared: string[] = [];
    try {
      const context = {
        switchProfile: async (name: string) => { switched.push(name); },
        clearProfile: async () => { cleared.push('off'); },
      } as unknown as CommandContext;
      const list = await persona!.run(['list'], context);
      assert.match(list.entries[0]?.subtitle ?? '', /active persona: reviewer/);
      assert.match(list.entries[0]?.title ?? '', /Correctness-focused review persona/);
      const show = await persona!.run(['show'], context);
      assert.match(show.entries[0]?.detail ?? '', /Review correctness/);
      await persona!.run(['reviewer'], context);
      await persona!.run(['off'], context);
      assert.deepEqual(switched, ['reviewer']);
      assert.deepEqual(cleared, ['off']);
      await assert.rejects(persona!.run(['missing'], context), /unknown persona missing/);
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe('/usage provider truthfulness', () => {
  it('renders provider limits and session consumption without inventing a quota', async () => {
    const opened: Array<{ title: string; hint?: string; items: readonly { value: string }[]; onPick: (value: string) => void }> = [];
    const notices: TimelineEntry[] = [];
    const context = {
      model: {
        info: { providerId: 'opencode-zen', id: 'deepseek-v4-flash-free' },
        getUsage: async () => ({
          provider: 'opencode-zen',
          model: 'deepseek-v4-flash-free',
          status: 'available',
          source: 'headers',
          fetchedAt: new Date(0).toISOString(),
          windows: [{
            type: 'minute',
            unit: 'requests',
            limit: 60,
            used: 4,
            remaining: 56,
            percentage: 7,
            source: 'headers',
          }],
        }),
      },
      sessionStatus: () => ({
        usage: {
          requests: 2,
          inputTokens: 120,
          outputTokens: 80,
          toolCalls: 0,
          turns: 1,
          subagentRuns: 0,
          subagentTokens: 0,
        },
      }),
      openPicker: (request: typeof opened[number]) => opened.push(request),
      notify: (notice: TimelineEntry) => notices.push(notice),
    } as unknown as CommandContext;

    const result = await usage!.run([], context);
    assert.deepEqual(result.entries, []);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(opened[0]?.title, 'Usage');
    assert.deepEqual(opened[0]?.items.map((item) => item.value), ['overview', 'limits', 'session', 'refresh']);
    assert.match(opened[0]?.hint ?? '', /choose a view/i);
    opened[0]?.onPick('limits');
    assert.match(notices[0]?.detail ?? '', /limit 60/);
    assert.match(notices[0]?.detail ?? '', /7% used/);
    assert.match(notices[0]?.detail ?? '', /requests 2/);
    assert.match(notices[0]?.subtitle ?? '', /official provider metadata/);
  });

  it('states when the adapter cannot expose usage instead of showing zero', async () => {
    const context = {
      model: { info: { providerId: 'local', id: 'model' } },
    } as unknown as CommandContext;
    const result = await usage!.run(['overview'], context);
    assert.match(result.entries[0]?.detail ?? '', /does not expose usage information/i);
    assert.match(result.entries[0]?.subtitle ?? '', /no quota was invented/i);
  });
});

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

  it('builds the effort picker from one stable capability snapshot', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-effort-picker-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');
    let calls = 0;
    let picker: { items?: readonly { value: string }[]; selected?: number } | undefined;
    try {
      await effort!.run([], {
        supportedEfforts: () => {
          calls += 1;
          return calls === 1
            ? ['low', 'medium', 'high', 'xhigh', 'max', 'plif']
            : ['medium'];
        },
        openPicker: (request) => {
          if ('items' in request) picker = request;
        },
      } as unknown as CommandContext);

      assert.equal(calls, 1, 'capabilities must be read once while opening the picker');
      assert.deepEqual(
        picker?.items?.map((item) => item.value),
        ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'plif'],
      );
      assert.equal(picker?.selected, 0);
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

  it('asks for the Codex FAST tier before applying a typed Codex model', async () => {
    let question: { text?: string; options?: readonly { value: string; description?: string }[] } | undefined;
    let switched: unknown;
    const models = COMMANDS.find((command) => command.name === 'models')!;
    await models.run(['codex-default'], {
      engine: { questions: { ask: async (value: typeof question) => {
        question = value;
        return 'fast';
      } } },
      switchModel: async (selection) => { switched = selection; },
    } as unknown as CommandContext);

    assert.equal(question?.text, 'Deseja usar o modo FAST?');
    assert.match(question?.options?.[0]?.description ?? '', /1,5×.*tokens/i);
    assert.deepEqual(switched, { preset: 'codex', model: 'codex-default', codexFast: true });
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
  it('discovers live Codex models in /models without making Codex active', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-codex-model-catalog-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    const previousCodexCommand = process.env['PLIF_CODEX_COMMAND'];
    const previousCodexModels = process.env['PLIF_CODEX_MODELS'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    process.env['PLIF_CODEX_COMMAND'] = await fakeCodexCommand(root);
    process.env['PLIF_CODEX_MODELS'] = 'multiple';
    await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');
    let picker: {
      items?: readonly {
        value: string;
        provider?: string;
        auth?: string;
        reasoning?: boolean;
        tools?: boolean;
        capabilities?: readonly string[];
      }[];
    } | undefined;
    try {
      await findCommand('models')!.run([], {
        openPicker: (request) => {
          if ('items' in request) picker = request as typeof picker;
        },
      } as unknown as CommandContext);
      const luna = picker?.items?.find((item) => item.value === 'codex:gpt-5.6-luna');
      const mini = picker?.items?.find((item) => item.value === 'codex:gpt-5.4-mini');
      assert.ok(luna, 'live Codex models must be present in the global model picker');
      assert.ok(mini, 'all live Codex models must be present in the global model picker');
      assert.match(luna.provider ?? '', /OpenAI Codex/i);
      assert.match(luna.auth ?? '', /ChatGPT sign-in/i);
      assert.equal(luna.reasoning, true);
      assert.equal(luna.tools, true);
      assert.deepEqual(luna.capabilities, ['text', 'vision']);
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      if (previousCodexCommand === undefined) delete process.env['PLIF_CODEX_COMMAND'];
      else process.env['PLIF_CODEX_COMMAND'] = previousCodexCommand;
      if (previousCodexModels === undefined) delete process.env['PLIF_CODEX_MODELS'];
      else process.env['PLIF_CODEX_MODELS'] = previousCodexModels;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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
      assert.ok(picker?.items?.some((item) => item.value === 'nexapi'));
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('revalidates an already selected Codex session before opening its models', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-codex-provider-picker-'));
    const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
    const previousCodexCommand = process.env['PLIF_CODEX_COMMAND'];
    process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
    process.env['PLIF_CODEX_COMMAND'] = await fakeCodexCommand(root);
    await saveGlobalConfig({ preset: 'codex', model: 'codex/codex-default' }, process.env['PLIF_CONFIG_PATH']);
    const opened: Array<{
      title: string;
      items: readonly { value: string }[];
      onPick: (value: string) => void | Promise<void>;
    }> = [];
    let loginCalls = 0;
    try {
      await findCommand('providers')!.run([], {
        loginCodex: async () => { loginCalls += 1; return false; },
        openPicker: (request) => {
          if ('items' in request) opened.push(request as typeof opened[number]);
        },
      } as unknown as CommandContext);
      assert.ok(opened[0]?.items.some((item) => item.value === 'codex'));
      opened[0]!.onPick('codex');
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      assert.equal(loginCalls, 1);
      assert.equal(opened.length, 1, 'a failed session check must not open the model picker');
    } finally {
      if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
      else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
      if (previousCodexCommand === undefined) delete process.env['PLIF_CODEX_COMMAND'];
      else process.env['PLIF_CODEX_COMMAND'] = previousCodexCommand;
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

  it('adds only registry facts to an id-only OpenCode Go discovery row', () => {
    const source = findCatalogProvider('opencode-go');
    assert.ok(source);
    const merged = mergeDiscoveredModel(source, 'glm-5.1', { id: 'glm-5.1' } as ProviderModel);
    assert.equal(merged.metadataSource, 'registry');
    assert.equal(merged.provider, 'opencode-go');
    assert.equal(merged.product, 'OpenCode');
    assert.equal(merged.tier, 'Go');
    assert.equal(merged.cost, 'paid');
    assert.equal(merged.contextWindow, undefined);
    assert.equal(merged.reasoning, undefined);
    assert.equal(merged.tools, undefined);
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
