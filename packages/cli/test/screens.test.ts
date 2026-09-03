import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ActivityDay, McpServerStatus } from '@plif/core';

import { SCREEN_TABS, initialSession, sessionReducer, tabbedScreen } from '../src/session.js';
import { filterMcpServers, healthOf } from '../src/components/McpScreen.js';
import {
  compactCount,
  heatLevel,
  heatmapWeeks,
  humanDuration,
  plural,
  shortDay,
} from '../src/components/StatsScreen.js';

function day(date: string, sessions: number): ActivityDay {
  return { date, sessions };
}

function server(overrides: Partial<McpServerStatus> & { name: string }): McpServerStatus {
  return {
    transport: 'stdio',
    connected: true,
    toolCount: 0,
    detail: '0 tools',
    endpoint: 'npx thing',
    recentCalls: [],
    ...overrides,
  };
}

describe('the screen bar', () => {
  it('cycles forward and backward, and wraps', () => {
    const first = SCREEN_TABS[0]!.id;
    const last = SCREEN_TABS.at(-1)!.id;
    assert.equal(tabbedScreen(first, 1), SCREEN_TABS[1]!.id);
    assert.equal(tabbedScreen(first, -1), last);
    assert.equal(tabbedScreen(last, 1), first);
  });

  it('leaves the screens that are not on the bar alone', () => {
    // Agents and sessions are pickers reached by their own command. Cycling
    // into one would drop the reader somewhere Tab cannot get them back from.
    assert.equal(tabbedScreen('agents', 1), null);
    assert.equal(tabbedScreen('sessions', -1), null);
  });
});

describe('activity heatmap', () => {
  it('pads the first week so every column lands on a real weekday', () => {
    // 2026-09-02 is a Wednesday, so the first column needs three empty cells
    // before it or every later column is off by three rows.
    const weeks = heatmapWeeks([day('2026-09-02', 1), day('2026-09-03', 2)]);
    assert.equal(weeks.length, 1);
    assert.deepEqual(weeks[0]!.map((cell) => cell?.date ?? null), [
      null, null, null, '2026-09-02', '2026-09-03', null, null,
    ]);
  });

  it('splits a run of days into whole weeks', () => {
    // 2026-09-06 is a Sunday, so ten days from it fill one week and part of
    // the next.
    const days = Array.from({ length: 10 }, (_unused, index) =>
      day(`2026-09-${String(6 + index).padStart(2, '0')}`, 1));
    const weeks = heatmapWeeks(days);
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0]!.filter(Boolean).length, 7);
    assert.equal(weeks[1]!.filter(Boolean).length, 3);
  });

  it('scales intensity against the busiest day rather than an absolute', () => {
    // A quiet month and a busy one should both use the whole ramp, or the map
    // is a flat wash that says nothing.
    assert.equal(heatLevel(0, 10), 0);
    assert.equal(heatLevel(10, 10), 4);
    assert.equal(heatLevel(1, 10), 1);
    // A single session is still the top of its own scale.
    assert.equal(heatLevel(1, 1), 4);
  });
});

describe('stats formatting', () => {
  it('compacts counts the way the reference does', () => {
    assert.equal(compactCount(0), '0');
    assert.equal(compactCount(999), '999');
    assert.equal(compactCount(1_800), '1.8k');
    assert.equal(compactCount(557_700), '557.7k');
    assert.equal(compactCount(177_800_000), '177.8m');
  });

  it('never writes a leading zero unit into a duration', () => {
    assert.equal(humanDuration(0), '-');
    assert.equal(humanDuration(12_000), '12s');
    assert.equal(humanDuration(90 * 60_000), '1h 30m 0s');
    assert.equal(humanDuration(5 * 60_000 + 9_000), '5m 9s');
  });

  it('agrees with its own noun', () => {
    assert.equal(plural(1, 'day'), '1 day');
    assert.equal(plural(2, 'day'), '2 days');
    assert.equal(plural(0, 'day'), '0 days');
  });

  it('names a day the short way', () => {
    assert.equal(shortDay('2026-09-01'), 'Sep 1');
  });
});

describe('MCP screen', () => {
  it('separates a server that failed from one that was never started', () => {
    // `connected: false` covers both, and they need different things done to
    // them, so the screen cannot show them the same way.
    assert.equal(healthOf(server({ name: 'ok' })), 'ok');
    assert.equal(
      healthOf(server({ name: 'broken', connected: false, detail: 'connection refused' })),
      'down',
    );
    assert.equal(
      healthOf(server({ name: 'idle', connected: false, detail: 'not connected' })),
      'warn',
    );
  });

  it('filters on the things a person would remember', () => {
    const servers = [
      server({ name: 'filesystem', endpoint: 'npx @mcp/filesystem' }),
      server({ name: 'notion', transport: 'http', endpoint: 'https://notion.example/mcp' }),
    ];
    assert.deepEqual(filterMcpServers(servers, 'noti').map((item) => item.name), ['notion']);
    assert.deepEqual(filterMcpServers(servers, 'http').map((item) => item.name), ['notion']);
    assert.deepEqual(filterMcpServers(servers, 'npx').map((item) => item.name), ['filesystem']);
    assert.equal(filterMcpServers(servers, '').length, 2);
  });
});

describe('stats screen state', () => {
  const opened = sessionReducer(initialSession, { type: 'screen.open', screen: 'stats' });

  it('opens on the overview, over all of the history, still loading', () => {
    assert.equal(opened.screen?.kind, 'stats');
    if (opened.screen?.kind !== 'stats') throw new Error('expected the stats screen');
    assert.equal(opened.screen.state.tab, 'overview');
    assert.equal(opened.screen.state.range, 'all');
    assert.equal(opened.screen.state.loading, true);
    assert.equal(opened.screen.stats, null);
  });

  it('switches sub-tab and range without losing what it has loaded', () => {
    const loaded = sessionReducer(opened, {
      type: 'stats.loaded',
      stats: {
        range: { from: '2026-09-01', to: '2026-09-01' },
        days: [{ date: '2026-09-01', sessions: 1 }],
        sessions: 1,
        activeDays: 1,
        totalDays: 1,
        mostActiveDay: { date: '2026-09-01', sessions: 1 },
        longestSessionMs: 0,
        longestStreak: 1,
        currentStreak: 1,
        favoriteModel: null,
        models: [],
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    });
    if (loaded.screen?.kind !== 'stats') throw new Error('expected the stats screen');
    assert.equal(loaded.screen.state.loading, false);

    const models = sessionReducer(loaded, { type: 'stats.tab', tab: 'models' });
    if (models.screen?.kind !== 'stats') throw new Error('expected the stats screen');
    assert.equal(models.screen.state.tab, 'models');
    // The sub-tab is a view of the same figures, so it must not throw them away.
    assert.equal(models.screen.stats?.sessions, 1);

    // A range change does reload, and says so rather than showing the old
    // numbers under the new label.
    const week = sessionReducer(models, { type: 'stats.range', range: '7d' });
    if (week.screen?.kind !== 'stats') throw new Error('expected the stats screen');
    assert.equal(week.screen.state.range, '7d');
    assert.equal(week.screen.state.loading, true);
  });

  it('ignores stats actions aimed at a screen that is not open', () => {
    const elsewhere = sessionReducer(initialSession, { type: 'screen.open', screen: 'config' });
    assert.equal(sessionReducer(elsewhere, { type: 'stats.tab', tab: 'models' }), elsewhere);
  });

  it('walks to the next screen on the bar and leaves the rest of the state alone', () => {
    const next = sessionReducer(opened, { type: 'screen.tab', delta: 1 });
    assert.equal(next.screen?.kind, tabbedScreen('stats', 1));
    assert.equal(next.picker, opened.picker);
  });
});
