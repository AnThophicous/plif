import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialSession, sessionReducer } from '../src/session.js';

function openWith(items: readonly { value: string; label: string }[], selected?: number): number | undefined {
  const state = sessionReducer(initialSession, {
    type: 'picker.open',
    picker: {
      title: 'pick one',
      items,
      ...(selected === undefined ? {} : { selected }),
      onPick: () => undefined,
    },
  } as never);
  return state.picker?.selected;
}

const THREE = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
];

describe('picker.open selection clamp', () => {
  it('keeps a selection that is already in range', () => {
    assert.equal(openWith(THREE, 1), 1);
    assert.equal(openWith(THREE, 0), 0);
    assert.equal(openWith(THREE, 2), 2);
  });

  it('pulls an index past the end back onto the last row', () => {
    // A caller computing its opening row from a list that has since changed —
    // or with an offset — would otherwise open the menu on a row that does not
    // exist, leaving nothing highlighted until the first keypress.
    assert.equal(openWith(THREE, 3), 2);
    assert.equal(openWith(THREE, 99), 2);
  });

  it('pulls a negative index back onto the first row', () => {
    assert.equal(openWith(THREE, -1), 0);
    assert.equal(openWith(THREE, -99), 0);
  });

  it('settles on zero for an empty list', () => {
    assert.equal(openWith([], 4), 0);
    assert.equal(openWith([]), 0);
  });

  it('defaults to the first row when the caller names none', () => {
    assert.equal(openWith(THREE), 0);
  });

  it('clamps a grouped picker against the rows it will actually show', () => {
    const state = sessionReducer(initialSession, {
      type: 'picker.open',
      picker: {
        title: 'select a model',
        groups: [
          { id: 'g1', label: 'One', items: [{ value: 'm1', label: 'M1' }] },
          { id: 'g2', label: 'Two', items: [{ value: 'm2', label: 'M2' }] },
        ],
        expanded: [],
        selected: 500,
        onPick: () => undefined,
      },
    } as never);

    const selected = state.picker?.selected ?? -1;
    assert.ok(selected >= 0, 'a grouped picker must not open on a negative row');
    assert.ok(selected < 500, 'a grouped picker must not keep an out-of-range row');
  });
});
