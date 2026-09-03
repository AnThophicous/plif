import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionMeta } from '@plif/core';

import {
  filterSessions,
  sessionBucket,
  sessionRows,
  metaColumns,
  turnsLabel,
} from '../src/components/SessionsScreen.js';

// Local times: the buckets are calendar-day based, so a UTC literal would
// land on a different day depending on where the test runs.
const NOW = new Date(2026, 8, 10, 12, 0, 0).getTime();
const local = (y: number, m: number, d: number, h: number): string =>
  new Date(y, m, d, h, 0, 0).toISOString();

function at(iso: string, over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: iso,
    title: `session ${iso}`,
    workspace: '/work',
    updatedAt: iso,
    turns: 1,
    ...over,
  } as SessionMeta;
}

describe('sessions screen grouping', () => {
  it('buckets by how a person thinks about time, not by hours', () => {
    assert.equal(sessionBucket(local(2026, 8, 10, 11), NOW), 'Today');
    // Eighteen hours old, but a different calendar day.
    assert.equal(sessionBucket(local(2026, 8, 9, 18), NOW), 'Yesterday');
    // Barely an hour older than the line above, and still yesterday.
    assert.equal(sessionBucket(local(2026, 8, 9, 23), NOW), 'Yesterday');
    assert.equal(sessionBucket(local(2026, 8, 6, 9), NOW), 'Earlier this week');
    assert.equal(sessionBucket(local(2026, 7, 1, 9), NOW), 'Older');
  });

  it('emits one heading per run, not one per session', () => {
    const rows = sessionRows(
      [
        at(local(2026, 8, 10, 11)),
        at(local(2026, 8, 9, 11)),
        at(local(2026, 8, 9, 10)),
        at(local(2026, 8, 8, 10)),
      ],
      NOW,
    );
    const headings = rows.filter((row) => row.kind === 'heading').map((row) => row.bucket);
    assert.deepEqual(headings, ['Today', 'Yesterday', 'Earlier this week']);
    assert.equal(rows.filter((row) => row.kind === 'session').length, 4);
  });

  it('keeps the session order and its index into the filtered list', () => {
    const rows = sessionRows([at(local(2026, 8, 10, 11)), at(local(2026, 8, 9, 11))], NOW);
    const sessions = rows.filter((row) => row.kind === 'session');
    assert.deepEqual(sessions.map((row) => row.index), [0, 1]);
  });

  it('returns nothing but a bucketless list when there are no sessions', () => {
    assert.deepEqual(sessionRows([], NOW), []);
  });

  it('still filters by title, model and workspace', () => {
    const all = [
      at(local(2026, 8, 10, 11), { title: 'landing page' }),
      at(local(2026, 8, 9, 11), { title: 'other', modelId: 'sonnet' }),
      at(local(2026, 8, 8, 11), { title: 'third', workspace: '/elsewhere' }),
    ];
    assert.equal(filterSessions(all, 'landing').length, 1);
    assert.equal(filterSessions(all, 'sonnet').length, 1);
    assert.equal(filterSessions(all, 'elsewhere').length, 1);
    assert.equal(filterSessions(all, '').length, 3);
  });
});

describe('sessions screen columns', () => {
  it('measures the metadata columns once for the whole list', () => {
    const columns = metaColumns(
      [
        at(local(2026, 8, 9, 11), { turns: 1 }),
        at(local(2026, 8, 3, 11), { turns: 24 }),
      ],
      NOW,
    );
    // "yesterday" is the widest age here, "24 turns" the widest count; both
    // rows are laid out to those widths so the divider forms one column.
    assert.equal(columns.age, 'yesterday'.length);
    assert.equal(columns.turns, '24 turns'.length);
  });

  it('never collapses below a usable width on an empty list', () => {
    const columns = metaColumns([]);
    assert.ok(columns.age >= 3);
    assert.ok(columns.turns >= 6);
  });

  it('writes a single turn without pluralising', () => {
    assert.equal(turnsLabel(1), '1 turn');
    assert.equal(turnsLabel(2), '2 turns');
    assert.equal(turnsLabel(0), '0 turns');
  });
});
