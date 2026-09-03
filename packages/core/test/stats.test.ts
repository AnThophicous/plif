import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dayKey, rangeStart, summariseSessions, totalTokens } from '../src/session/stats.js';
import type { SessionUsageRow } from '../src/session/history-repository.js';

/** A local-midnight ISO string `offset` days before `now`. */
function daysAgo(now: Date, offset: number): string {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 10, 0, 0);
  return at.toISOString();
}

function row(overrides: Partial<SessionUsageRow> & { sessionId: string; createdAt: string }): SessionUsageRow {
  return {
    workspace: '/w',
    updatedAt: overrides.createdAt,
    turns: 1,
    modelId: 'opus-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

const NOW = new Date(2026, 8, 1, 12, 0, 0);

describe('session stats', () => {
  it('counts a session once even when it used two models', () => {
    // Rows arrive one per (session, model). Counting rows would report a
    // session that switched models as two sessions, and double its day.
    const stats = summariseSessions([
      row({ sessionId: 's1', createdAt: daysAgo(NOW, 0), modelId: 'opus-5', outputTokens: 100 }),
      row({ sessionId: 's1', createdAt: daysAgo(NOW, 0), modelId: 'haiku-4-5', outputTokens: 40 }),
    ], { now: NOW });

    assert.equal(stats.sessions, 1);
    assert.equal(stats.activeDays, 1);
    assert.equal(stats.models.length, 2);
    assert.equal(stats.favoriteModel?.modelId, 'opus-5');
    assert.equal(totalTokens(stats.tokens), 140);
    assert.equal(Math.round((stats.favoriteModel?.share ?? 0) * 100), 71);
  });

  it('measures the longest run of consecutive days', () => {
    const stats = summariseSessions([
      row({ sessionId: 'a', createdAt: daysAgo(NOW, 10) }),
      row({ sessionId: 'b', createdAt: daysAgo(NOW, 9) }),
      row({ sessionId: 'c', createdAt: daysAgo(NOW, 8) }),
      // Gap.
      row({ sessionId: 'd', createdAt: daysAgo(NOW, 5) }),
    ], { now: NOW });

    assert.equal(stats.longestStreak, 3);
    assert.equal(stats.activeDays, 4);
  });

  it('keeps the current streak alive on the day after the last session', () => {
    // A streak must not read as broken for the whole of the day before you
    // next sit down, so yesterday still counts as current.
    const yesterday = summariseSessions([
      row({ sessionId: 'a', createdAt: daysAgo(NOW, 2) }),
      row({ sessionId: 'b', createdAt: daysAgo(NOW, 1) }),
    ], { now: NOW });
    assert.equal(yesterday.currentStreak, 2);

    const stale = summariseSessions([
      row({ sessionId: 'a', createdAt: daysAgo(NOW, 4) }),
      row({ sessionId: 'b', createdAt: daysAgo(NOW, 3) }),
    ], { now: NOW });
    assert.equal(stale.currentStreak, 0);
    assert.equal(stale.longestStreak, 2);
  });

  it('reports the busiest day and the longest session', () => {
    const start = daysAgo(NOW, 1);
    const stats = summariseSessions([
      row({ sessionId: 'a', createdAt: daysAgo(NOW, 3) }),
      row({ sessionId: 'b', createdAt: start, updatedAt: new Date(Date.parse(start) + 90 * 60_000).toISOString() }),
      row({ sessionId: 'c', createdAt: start }),
    ], { now: NOW });

    assert.equal(stats.mostActiveDay?.sessions, 2);
    assert.equal(stats.longestSessionMs, 90 * 60_000);
  });

  it('keeps sessions recorded before usage was tracked', () => {
    // They contribute days, streaks and length; they simply have no tokens.
    const stats = summariseSessions([
      row({ sessionId: 'old', createdAt: daysAgo(NOW, 3), modelId: '' }),
    ], { now: NOW });

    assert.equal(stats.sessions, 1);
    assert.equal(stats.activeDays, 1);
    assert.equal(totalTokens(stats.tokens), 0);
    assert.equal(stats.models.length, 0);
    assert.equal(stats.favoriteModel, null);
  });

  it('drops sessions outside the requested range', () => {
    const since = rangeStart('7d', NOW);
    const stats = summariseSessions([
      row({ sessionId: 'old', createdAt: daysAgo(NOW, 20) }),
      row({ sessionId: 'new', createdAt: daysAgo(NOW, 2) }),
    ], { now: NOW, ...(since ? { since } : {}) });

    assert.equal(stats.sessions, 1);
    assert.equal(stats.totalDays, 7);
    assert.equal(stats.days.at(-1)?.date, dayKey(NOW));
  });

  it('produces one heatmap cell per day, including the empty ones', () => {
    const stats = summariseSessions([
      row({ sessionId: 'a', createdAt: daysAgo(NOW, 2) }),
      row({ sessionId: 'b', createdAt: daysAgo(NOW, 0) }),
    ], { now: NOW });

    assert.deepEqual(stats.days.map((day) => day.sessions), [1, 0, 1]);
    assert.equal(stats.totalDays, 3);
  });
});
