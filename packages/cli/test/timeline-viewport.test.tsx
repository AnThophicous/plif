/**
 * The transcript viewport: what it asks Slate for, and when it lets go.
 *
 * All three cases here were live bugs — a wheel that could not move the view,
 * a prompt pushed off the bottom of the window, and a resumed session that
 * opened already believing the reader had scrolled away from it.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { timelineViewport, useTailFollow } from '../src/components/Timeline.js';
import { Text, render } from '../src/ui.js';

class Silent extends EventEmitter {
  columns = 80;
  rows = 40;
  isTTY = true as const;
  write(): boolean {
    return true;
  }
}

const noop = (): void => undefined;

test('pinning is only asserted while the view is at the tail', () => {
  const pinned = timelineViewport(20, true, false, noop);
  assert.equal(pinned.scrollTop, 0);

  const away = timelineViewport(20, false, true, noop);
  assert.equal(
    'scrollTop' in away,
    false,
    'a scrolled-away view must keep its own offset, or the wheel is re-clamped every frame',
  );
});

test('a pinned viewport receives a fresh tail instruction when activity appends rows', () => {
  const before = timelineViewport(20, true, false, noop, 120);
  const after = timelineViewport(20, true, false, noop, 121);
  assert.notEqual(before.scrollTop, after.scrollTop);
  assert.equal(after.scrollTop, 121);
});

test('the jump pill comes out of the timeline budget, not out of the prompt', () => {
  assert.equal(timelineViewport(20, true, false, noop).height, 20);
  assert.equal(
    timelineViewport(20, false, true, noop).height,
    19,
    'the pill is a row of this block; leaving it out of the height overflows the panel',
  );
  assert.equal(timelineViewport(1, false, true, noop).height, 1, 'never below one row');
  assert.equal(timelineViewport(0, false, false, noop).height, 1);
});

test('the viewport always scrolls and always reports', () => {
  const seen: number[] = [];
  const viewport = timelineViewport(10, true, false, (_x, y) => seen.push(y));
  assert.equal(viewport.overflow, 'scroll');
  viewport.onScroll(0, 7);
  assert.deepEqual(seen, [7]);
});

/** Drives useTailFollow through a real render so the effects actually run. */
async function follow(initialRows: number) {
  let api: ReturnType<typeof useTailFollow> | undefined;
  let setRows: ((rows: number) => void) | undefined;

  function Probe(): React.ReactElement {
    const [rows, setter] = React.useState(initialRows);
    setRows = setter;
    api = useTailFollow(rows, noop);
    return React.createElement(Text, null, String(rows));
  }

  const app = render(React.createElement(Probe), { stdout: new Silent() as never });
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  await settle();
  return {
    get pinned(): boolean {
      return api!.pinned;
    },
    get addedWhileAway(): number {
      return api!.addedWhileAway;
    },
    scroll: async (y: number): Promise<void> => {
      api!.onScroll(0, y);
      await settle();
    },
    setRows: async (rows: number): Promise<void> => {
      setRows!(rows);
      await settle();
    },
    stop: (): void => app.unmount(),
  };
}

test('scrolling away unpins, and returning to the end re-pins', async () => {
  const view = await follow(80);
  try {
    assert.equal(view.pinned, true, 'a fresh view starts at its newest row');
    await view.scroll(60);
    assert.equal(view.pinned, true, 'the first offset seen is the furthest known end');
    await view.scroll(20);
    assert.equal(view.pinned, false, 'moving back up is being away');
    await view.scroll(60);
    assert.equal(view.pinned, true, 'coming back down re-anchors without a keystroke');
  } finally {
    view.stop();
  }
});

test('a replaced transcript drops the previous high-water mark', async () => {
  const view = await follow(80);
  try {
    await view.scroll(60);
    await view.scroll(20);
    assert.equal(view.pinned, false);

    // Resuming a session from the picker: fewer rows than the transcript that
    // was on screen. Carrying the old mark across made the new session open
    // reporting itself as scrolled away, which showed the jump pill and cost
    // the prompt its row.
    await view.setRows(12);
    assert.equal(view.pinned, true, 'a resumed session opens at its own newest row');
    assert.equal(view.addedWhileAway, 0, 'nothing arrived while away in a transcript that just started');

    await view.scroll(5);
    assert.equal(view.pinned, true, 'the stale mark is gone, so a small offset is still the end');
  } finally {
    view.stop();
  }
});

test('an emptied transcript re-anchors', async () => {
  const view = await follow(40);
  try {
    await view.scroll(30);
    await view.scroll(4);
    assert.equal(view.pinned, false);
    await view.setRows(0);
    assert.equal(view.pinned, true, '/clear leaves nothing to be behind');
  } finally {
    view.stop();
  }
});
