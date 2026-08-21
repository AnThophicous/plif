import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMANDS, findCommand, runsWhileWorking } from '../src/commands.js';
import { contextBar, contextPercent, emptySessionUsage, formatStatus } from '../src/status.js';
import { statusSections } from '../src/components/StatusScreen.js';
import type { StatusInput } from '../src/status.js';

const BASE: StatusInput = {
  model: 'z-ai/glm-5.2',
  provider: 'integrate.api.nvidia.com',
  effort: 'plif',
  contextUsed: 38_400,
  contextMax: 200_000,
  elapsedMs: 1_453_000,
  usage: {
    ...emptySessionUsage,
    requests: 49,
    inputTokens: 312_500,
    outputTokens: 18_200,
    toolCalls: 41,
    turns: 7,
  },
  workspace: 'C:\\workspace\\FrontTest',
  container: 'plif-quiet-otter',
  containerState: 'running',
  planMode: false,
  goal: null,
  mcpConnected: 2,
  mcpServers: 3,
  skills: 12,
  queued: 0,
  sessionId: null,
};

const report = (overrides: Partial<StatusInput> = {}): string =>
  formatStatus({ ...BASE, ...overrides, permission: 'ask', autoApprove: false });

describe('the status report', () => {
  it('states what is spending the tokens and how many it has spent', () => {
    const text = report();

    assert.match(text, /model {6}z-ai\/glm-5\.2/);
    assert.match(text, /integrate\.api\.nvidia\.com/);
    assert.match(text, /effort .*PLIF/);
    assert.match(text, /312\.5k in/);
    assert.match(text, /18\.2k out/);
    assert.match(text, /49 requests/);
    assert.match(text, /7 turns/);
    assert.match(text, /41 tool calls/);
  });

  it('shows the context window as a share of what it holds', () => {
    assert.equal(contextPercent(38_400, 200_000), 19);
    assert.equal(contextPercent(0, 0), 0);
    assert.equal(contextBar(50, 100, 10).length, 10);
    assert.match(report(), /38\.4k \/ 200\.0k/);
    assert.match(report(), /19%/);
  });

  it('names the container, the approval posture and the extensions in play', () => {
    const text = report();

    assert.match(text, /plif-quiet-otter \(running\)/);
    assert.match(text, /ask/);
    assert.match(text, /auto-approve off/);
    assert.match(text, /2\/3 MCP/);
    assert.match(text, /12 skills/);
  });

  it('leaves out what has not happened, and reports what has', () => {
    assert.doesNotMatch(report(), /delegated/);
    assert.doesNotMatch(report(), /goal/);

    const busy = report({
      goal: 'ship the explore page',
      queued: 2,
      usage: { ...BASE.usage, subagentRuns: 2, subagentTokens: 24_100 },
    });
    assert.match(busy, /delegated {2}2 subagents/);
    assert.match(busy, /24\.1k tokens/);
    assert.match(busy, /2 queued/);
    assert.match(busy, /goal\s+ship the explore page/);
  });

  it('says nothing is configured rather than showing a blank model', () => {
    assert.match(report({ model: '', container: null, containerState: null }), /not configured/);
    assert.match(report({ container: null, containerState: null }), /none yet/);
  });

  it('singularises the counts that can legitimately be one', () => {
    const text = report({
      usage: { ...emptySessionUsage, requests: 1, turns: 1, toolCalls: 1 },
      skills: 1,
    });

    assert.match(text, /1 turn\b/);
    assert.match(text, /1 tool call\b/);
    assert.match(text, /1 request\b/);
    assert.match(text, /1 skill\b/);
  });
});

describe('the full-screen status snapshot', () => {
  it('shows real runtime/configuration metadata without exposing config secrets', () => {
    const sections = statusSections(
      BASE,
      '0.3.0',
      {
        theme: 'midnight',
        permissionMode: 'ask',
        apiKey: 'sk-never-show-this',
        providerKeys: { opencode: 'also-secret' },
      },
      'minimal',
      'C:\\workspace\\.plif\\config.toml',
      false,
      null,
      'API request failed at https://user:sk-provider-secret@example.invalid/v1',
    );
    const text = JSON.stringify(sections);

    assert.match(text, /0\.3\.0/);
    assert.match(text, /midnight/);
    assert.match(text, /19%/);
    assert.match(text, /2\/3 connected/);
    assert.doesNotMatch(text, /never-show-this|also-secret|sk-provider-secret|example\.invalid/);
    assert.equal(sections.find((section) => section.title === 'Runtime')?.rows.find((row) => row.label === 'Provider state')?.value, 'needs attention');
    assert.equal(sections.find((section) => section.title === 'Runtime')?.rows.some((row) => row.label === 'Provider state'), true);
  });

  it('states when the persisted config cannot be read instead of inventing values', () => {
    const sections = statusSections(BASE, '0.3.0', null, 'minimal', '~/.plif/config.toml', false, 'config unavailable');
    const configuration = sections.find((section) => section.title === 'Configuration');
    assert.equal(configuration?.rows.find((row) => row.label === 'Source')?.value, 'unavailable');
    assert.equal(configuration?.rows.find((row) => row.label === 'Permissions')?.value, 'unknown');
  });
});

describe('commands that answer while the agent is working', () => {
  it('exposes /status, and it is one of them', () => {
    assert.ok(findCommand('status'));
    assert.equal(runsWhileWorking('status'), true);
  });

  it('lets the read-only screens through and holds back the ones that would disturb the turn', () => {
    for (const name of ['help', 'sandbox', 'policy', 'ps', 'audit', 'mcp', 'skills']) {
      assert.equal(runsWhileWorking(name), true, `/${name} should answer while working`);
    }
    for (const name of ['clear', 'compact', 'model', 'effort', 'new', 'exit', 'plan']) {
      assert.equal(runsWhileWorking(name), false, `/${name} must wait for the turn`);
    }
  });

  it('says no for a command that does not exist', () => {
    assert.equal(runsWhileWorking('definitely-not-a-command'), false);
    assert.equal(runsWhileWorking(''), false);
  });

  it('keeps every summary short enough to read in the menu', () => {
    for (const command of COMMANDS) {
      assert.ok(command.summary.length <= 80, `/${command.name}: ${command.summary}`);
    }
  });

  it('routes /status and bare /config to their full-screen views', async () => {
    const opened: string[] = [];
    const context = {
      openStatus: () => opened.push('status'),
      openConfig: () => opened.push('config'),
    } as never;

    assert.deepEqual(await findCommand('status')!.run([], context), { entries: [] });
    assert.deepEqual(await findCommand('config')!.run([], context), { entries: [] });
    assert.deepEqual(opened, ['status', 'config']);
  });
});
