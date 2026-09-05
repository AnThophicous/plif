/**
 * Screen previewer.
 *
 * `preview.mts` drives the whole App, which needs a configured provider and a
 * real session before it will show a screen at all. These views are pure
 * components over plain data, so they can be rendered directly against
 * fixtures — which is the only practical way to iterate on their layout.
 *
 *   node --import tsx packages/cli/dev/screens-check.mts [columns] [screen] [rows]
 */

import './force-color.mjs';

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import React from 'react';

import { render } from '../src/ui.js';
import { UsageScreen } from '../src/components/UsageScreen.js';
import { AgentsScreen } from '../src/components/AgentsScreen.js';
import { SessionsScreen } from '../src/components/SessionsScreen.js';
import { EffortSelector } from '../src/components/Picker.js';
import { ToolCall } from '../src/components/ToolCall.js';
import { effortPickerItems } from '../src/components/Picker.js';
import { activateTheme, loadThemes } from '../src/themes.js';

const columns = Number(process.argv[2] ?? 110);
const rows = Number(process.argv[4] ?? 30);
const which = process.argv[3] ?? 'usage';

class Out extends EventEmitter {
  columns = columns;
  rows = rows;
  isTTY = true as const;
  frames: string[] = [];
  write(chunk: string): boolean { this.frames.push(chunk); return true; }
  end(): void {}
}

class In extends Readable {
  isTTY = true as const;
  _read(): void {}
  setRawMode(): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

const usage = {
  provider: 'opencode',
  model: 'nemotron-3.5-lightning-free',
  status: 'available' as const,
  source: 'headers' as const,
  fetchedAt: Date.now(),
  windows: [
    { type: 'requests / minute', unit: 'requests' as const, limit: 60, remaining: 41, source: 'headers' as const },
    {
      type: 'tokens / day',
      unit: 'tokens' as const,
      limit: 2_000_000,
      used: 1_640_000,
      source: 'headers' as const,
      resetAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
    },
    { type: 'credits', unit: 'credits' as const, unlimited: true, source: 'config' as const },
  ],
};

const session = {
  requests: 89,
  inputTokens: 1_240_000,
  outputTokens: 238_400,
  toolCalls: 143,
  turns: 47,
  subagentRuns: 3,
  subagentTokens: 96_200,
};

const agents = [
  { name: 'explore', model: 'nemotron-3.5-lightning-free', description: 'Read-only search across the repo', builtin: true, enabled: true, runs: 12 },
  { name: 'reviewer', model: 'claude-opus-5', description: 'Reviews the diff before it ships', builtin: false, enabled: true, runs: 4 },
  { name: 'plan', model: 'claude-sonnet-5', description: 'Designs the implementation before code', builtin: true, enabled: true, runs: 0 },
  { name: 'scribe', model: 'gpt-5-mini', description: '', builtin: false, enabled: false, runs: 0 },
];

const sessions = [
  { id: 'a1b2c3d4e5f6', workspace: 'C:/Users/eds/Downloads/plif-main', createdAt: new Date(Date.now() - 7200_000).toISOString(), updatedAt: new Date(Date.now() - 7200_000).toISOString(), title: 'refactor do reconciler para parar de re-medir texto', turns: 47, container: null, providerId: 'opencode', modelId: 'nemotron-3.5-lightning-free' },
  { id: 'b2c3d4e5f6a7', workspace: 'C:/Users/eds/Downloads/plif-main', createdAt: new Date(Date.now() - 86_400_000).toISOString(), updatedAt: new Date(Date.now() - 86_400_000).toISOString(), title: 'auditoria visual das telas', turns: 12, container: null, providerId: 'opencode', modelId: 'nemotron-3.5-lightning-free' },
  { id: 'c3d4e5f6a7b8', workspace: 'C:/Users/eds/projects/outro', createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), title: 'plif 0.4.0 release checklist', turns: 118, container: 'plif-box', providerId: 'anthropic', modelId: 'claude-opus-5' },
];


const FILE_SAMPLE = [
  '/**',
  " * Makes Slate's grapheme measurement cheap enough to animate against.",
  ' *',
  ' * `segmentGraphemes` builds a fresh `Intl.Segmenter` on every call, and Slate',
  ' * calls it for each text node on each layout pass of each frame.',
  ' */',
  '',
  "import { readFileSync, writeFileSync } from 'node:fs';",
  '',
  'const root = process.cwd();',
  'const targets = [];',
  'for (const target of targets) {',
  '  writeFileSync(target.file, target.content);',
  '}',
].join(String.fromCharCode(10));

const screens: Record<string, () => React.ReactElement> = {
  usage: () => React.createElement(UsageScreen, {
    info: usage, session, contextUsed: 47_200, contextMax: 128_000,
    elapsedMs: 3_720_000, effort: 'high', loading: false, width: columns, rows,
  }),
  'usage-empty': () => React.createElement(UsageScreen, {
    info: null, session, contextUsed: 0, contextMax: 0,
    elapsedMs: 0, loading: false, width: columns, rows,
  }),
  agents: () => React.createElement(AgentsScreen, {
    agents, selected: 1, filter: '', width: columns, rows,
  }),
  sessions: () => React.createElement(SessionsScreen, {
    sessions, selected: 0, filter: '', workspace: 'C:/Users/eds/Downloads/plif-main',
    loading: false, width: columns, rows,
  }),
  write: () => React.createElement(ToolCall, {
    name: 'Write', target: 'scripts/patch-slate-text.mjs', ok: true, running: false,
    width: columns, expand: false, code: FILE_SAMPLE, codeMode: 'creating',
    codePath: 'scripts/patch-slate-text.mjs', codeAdded: 14, codeRemoved: 0,
  }),
  effort: () => React.createElement(EffortSelector, {
    items: effortPickerItems(['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode', 'plif'], 'high'),
    selected: 3,
    width: columns,
  }),
};

const build = screens[which];
if (!build) {
  console.error(`unknown screen "${which}". Available: ${Object.keys(screens).join(', ')}`);
  process.exit(1);
}

await loadThemes();
activateTheme('plif');

const out = new Out();
const app = render(build(), { stdout: out as never, stdin: new In() as never });
await new Promise((resolve) => setTimeout(resolve, 220));
app.unmount();
process.stdout.write(`${out.frames.join('')}\n`);
