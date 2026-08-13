import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TaskSnapshot } from '@plif/core';

import { focusRule, infinityCells, infinityFrame } from '../src/components/FocusFrame.js';
import { plifDockHeight } from '../src/components/PlifDock.js';
import { workDockHeight } from '../src/components/WorkDock.js';
import type { SubagentView } from '../src/session.js';

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
  it('fills a focused rule to the requested terminal width', () => {
    const rule = focusRule(42, 480, true);
    assert.equal(rule.map((cell) => cell.text).join('').length, 42);
    assert.ok(new Set(rule.map((cell) => cell.color)).size > 1);
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

  it('reserves the dock row and its divider, and nothing outside Plif effort', () => {
    // The dock shares the prompt's walls, so it costs its own row plus the
    // inset rule that joins it — budgeting one would let the frame overrun.
    assert.equal(plifDockHeight(undefined), 0);
    assert.equal(plifDockHeight('plif'), 2);
  });
});

describe('upper work dock', () => {
  it('disappears at rest and grows when active work is expanded', () => {
    assert.equal(workDockHeight([], [], false), 0);
    assert.ok(workDockHeight([task], [subagent], true) > workDockHeight([task], [subagent], false));
    assert.equal(workDockHeight([task], [subagent], true), 6);
  });
});
