import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import type { TaskSnapshot } from '@plif/core';
import { Box, render, Text } from 'ink';
import React from 'react';

import { FocusFrame, focusRule, infinityCells, infinityFrame } from '../src/components/FocusFrame.js';
import { PlifDock, plifDockHeight } from '../src/components/PlifDock.js';
import { plifGlowCells } from '../src/components/PlifGlow.js';
import { operationalEntries, workDockHeight } from '../src/components/WorkDock.js';
import type { SubagentView } from '../src/session.js';
import { displayWidth } from '../src/text.js';
import { applyEffortPalette } from '../src/theme.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureStdout extends EventEmitter {
  columns: number;
  rows: number;
  isTTY = true as const;
  output = '';

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

async function renderConstrainedPrompt(): Promise<string> {
  const stdout = new CaptureStdout(40, 14);
  const suggestions = React.createElement(
    Box,
    { flexDirection: 'column' },
    ...Array.from({ length: 7 }, (_, index) => React.createElement(Text, { key: index }, `command ${index}`)),
  );
  const app = render(
    React.createElement(
      Box,
      { flexDirection: 'column', width: 40, height: 14 },
      React.createElement(Text, null, '~/project'),
      suggestions,
      React.createElement(Box, { flexGrow: 1 }),
      React.createElement(
        FocusFrame,
        { width: 40, active: false },
        React.createElement(Text, null, 'typed command'),
      ),
      React.createElement(Text, null, 'footer'),
    ),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return stdout.output.replace(ANSI, '').replace(/\r/g, '');
}

async function renderCompactDock(width: number): Promise<string> {
  const stdout = new CaptureStdout(width, 4);
  const app = render(
    React.createElement(
      Box,
      { width },
      React.createElement(PlifDock, {
        cwd: 'C:\\Users\\Elaine Araújo\\Documents\\Plif-Code',
        model: 'deepseek-v4-flash-free',
        effort: 'plif',
        contextUsed: 50,
        contextMax: 100,
        working: true,
        width,
      }),
    ),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return stdout.output.replace(ANSI, '').replace(/\r/g, '');
}

async function renderNarrowFrame(width: number): Promise<string[]> {
  const stdout = new CaptureStdout(width, 12);
  const app = render(
    React.createElement(
      FocusFrame,
      { width, active: true },
      React.createElement(Text, null, 'typed command'),
    ),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return stdout.output
    .replace(ANSI, '')
    .replace(/\r/g, '')
    .split('\n')
    .filter(Boolean);
}

async function renderDock(width: number, model: string): Promise<string> {
  const stdout = new CaptureStdout(width, 4);
  const app = render(
    React.createElement(
      Box,
      { width },
      React.createElement(PlifDock, {
        cwd: 'C:\\Users\\Elaine Araújo\\Documents\\Plif-Code',
        model,
        effort: 'max',
        contextUsed: 50,
        contextMax: 100,
        working: false,
        width,
      }),
    ),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return stdout.output.replace(ANSI, '').replace(/\r/g, '');
}

const task: TaskSnapshot = {
  id: 'build',
  title: 'npm run build',
  argv: ['npm', 'run', 'build'],
  reason: 'verification',
  containerId: 'container',
  status: 'running',
  createdAt: 1,
  startedAt: 1,
  endedAt: null,
  exitCode: null,
  stdout: '',
  stderr: '',
  error: null,
};

const subagent: SubagentView = {
  taskId: 'agent',
  title: 'Inspect the harness',
  model: 'test/model',
  startedAt: 1,
  endedAt: null,
  status: 'running',
  summary: null,
  lines: [],
  thinkingSince: null,
  toolCalls: 0,
  contextUsed: 0,
  contextMax: 100,
  completionTokens: 0,
};

describe('Plif focus frame', () => {
  it('uses real Unicode glyphs in classic Windows cmd', () => {
    const env = { ...process.env };
    delete env['WT_SESSION'];
    delete env['TERM_PROGRAM'];
    delete env['ConEmuANSI'];
    delete env['TERM'];

    const themeUrl = new URL('../src/theme.ts', import.meta.url).href;
    const script = `const theme = await import(${JSON.stringify(themeUrl)}); process.stdout.write(JSON.stringify({ rich: theme.supportsRichGlyphs, prompt: theme.glyph.prompt }));`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { rich: true, prompt: '›' });
  });

  it('keeps the typed row visible when command suggestions consume the spare height', async () => {
    const frame = await renderConstrainedPrompt();
    assert.match(frame, /╭─+╮[\s\S]*│ typed command\s+│[\s\S]*╰─+╯/);
  });

  it('keeps every narrow frame row inside the requested width', async () => {
    for (const width of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const lines = await renderNarrowFrame(width);
      assert.equal(lines.length, 3, `width ${width} should stay three rows`);
      assert.ok(lines.every((line) => displayWidth(line) <= width), `width ${width} overflowed`);
      assert.equal(displayWidth(lines[0] ?? ''), width);
      assert.equal(displayWidth(lines[2] ?? ''), width);
    }
  });

  it('fills a focused rule to the requested terminal width', () => {
    const rule = focusRule(42, 480, true);
    assert.equal(rule.map((cell) => cell.text).join('').length, 42);
    assert.equal(new Set(rule.map((cell) => cell.color)).size, 1);
  });

  it('holds the infinity shape still and animates it with light instead', () => {
    // The mark is four cells wide, so swapping frames would make it flicker
    // rather than move. Its shape is constant at every instant and in both
    // states; what travels is the colour.
    assert.equal(infinityFrame(0, false), infinityFrame(1_000, false));
    assert.equal(infinityFrame(0, true), infinityFrame(400, true));
    assert.equal(
      infinityCells(0, true).map((cell) => cell.text).join(''),
      infinityCells(400, true).map((cell) => cell.text).join(''),
    );
  });

  it('lights the working infinity unevenly and leaves the idle one flat', () => {
    const working = infinityCells(120, true).map((cell) => cell.color);
    const idle = infinityCells(120, false).map((cell) => cell.color);

    assert.ok(new Set(working).size > 1, 'a working mark has a travelling highlight');
    assert.equal(new Set(idle).size, 1, 'an idle mark is one flat tone');
    assert.notDeepEqual(working, infinityCells(600, true).map((cell) => cell.color));
  });

  it('moves Plif light without changing graphemes or display width', () => {
    const value = 'typed command';
    const first = plifGlowCells(value, 0);
    const later = plifGlowCells(value, 900);

    assert.equal(first.map((cell) => cell.text).join(''), value);
    assert.equal(later.map((cell) => cell.text).join(''), value);
    assert.equal(displayWidth(first.map((cell) => cell.text).join('')), displayWidth(value));
    assert.equal(displayWidth(later.map((cell) => cell.text).join('')), displayWidth(value));
    assert.notDeepEqual(first, later);
  });

  it('keeps the active input frame solid instead of drawing an accidental gradient', () => {
    const first = focusRule(42, 0, true, 'top', true);
    const later = focusRule(42, 900, true, 'top', true);

    assert.equal(first.map((cell) => cell.text).join(''), later.map((cell) => cell.text).join(''));
    assert.deepEqual(first.map((cell) => cell.color), later.map((cell) => cell.color));
  });

  it('uses a distinct animated frame identity for each high-impact effort', () => {
    applyEffortPalette('max');
    const max = focusRule(42, 240, true, 'top', false, 'max');
    applyEffortPalette('ultra');
    const ultra = focusRule(42, 240, true, 'top', false, 'ultra');
    applyEffortPalette('ultracode');
    const ultracode = focusRule(42, 240, true, 'top', false, 'ultracode');

    assert.equal(max.map((cell) => cell.text).join(''), ultra.map((cell) => cell.text).join(''));
    assert.notDeepEqual(max.map((cell) => cell.color), ultra.map((cell) => cell.color));
    assert.notDeepEqual(ultra.map((cell) => cell.color), ultracode.map((cell) => cell.color));
    applyEffortPalette();
  });

  it('reserves the dock row and its divider for every visible effort', () => {
    // The dock shares the prompt's walls, so it costs its own row plus the
    // inset rule that joins it — budgeting one would let the frame overrun.
    assert.equal(plifDockHeight(undefined), 0);
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode', 'plif']) {
      assert.equal(plifDockHeight(effort), 2, effort);
    }
  });

  it('collapses ambient dock facts before they can wrap a compact terminal', async () => {
    const rendered = await renderCompactDock(24);
    const lines = rendered.split('\n').filter((line) => line.length > 0);
    assert.equal(lines.length, 1);
    assert.ok(lines.every((line) => displayWidth(line) <= 24));
    assert.doesNotMatch(rendered, /Documents|Context/);
  });

  it('shows the active model immediately before the context meter', async () => {
    const rendered = await renderDock(100, 'deepseek-v4-flash-free');
    assert.ok(rendered.indexOf('deepseek-v4-flash-free') >= 0);
    assert.ok(rendered.indexOf('deepseek-v4-flash-free') < rendered.indexOf('Context'));
  });
});

describe('upper work dock', () => {
  it('disappears at rest and grows when active work is expanded', () => {
    assert.equal(workDockHeight([], [], false), 0);
    assert.equal(workDockHeight([task], [], false), 1);
    assert.equal(workDockHeight([task], [], true), 2);
    assert.ok(workDockHeight([task], [subagent], true) > workDockHeight([task], [subagent], false));
    // Header, task row, agent row, and the navigation hint row.
    assert.equal(workDockHeight([task], [subagent], true), 4);
  });

  it('keeps the operational dock to real inputs and commands from the latest turn', () => {
    const entries = [
      { id: 'old', kind: 'input', title: 'old', at: 1 },
      { id: 'old-tool', kind: 'tool', title: 'old command', status: 'done', at: 2 },
      { id: 'new', kind: 'input', title: 'new', at: 3 },
      { id: 'thinking', kind: 'thinking', title: 'plan text', status: 'done', at: 4 },
      { id: 'new-tool', kind: 'tool', title: 'run command', status: 'active', at: 5 },
    ] as const;
    assert.deepEqual(operationalEntries(entries).map((item) => item.title), ['new', 'run command']);
    assert.equal(workDockHeight([], [], true, entries), 3);
  });
});
