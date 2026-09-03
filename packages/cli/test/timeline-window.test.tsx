import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { Box, Text, render } from '../src/ui.js';
import { Timeline } from '../src/components/Timeline.js';
import { activateTheme, loadThemes } from '../src/themes.js';
import type { TimelineEntry } from '../src/session.js';

/**
 * The transcript is windowed: only the rows that can be on screen are handed
 * to the renderer, with the height of the rest carried by two spacers. These
 * tests pin the two properties that windowing must never break — the newest
 * rows are the ones on screen, and the surfaces *below* the transcript (the
 * prompt, in the real app) are still laid out where the reader can see them.
 */

class CaptureOutput extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true as const;
  frames: string[] = [];
  write(chunk: string | Uint8Array): boolean {
    this.frames.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '');
}

function entries(count: number): TimelineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index}`,
    kind: 'step' as const,
    title: `entry ${index}`,
    at: index,
  }));
}

await loadThemes();
activateTheme('default');

async function frame(count: number, maxLines: number): Promise<string> {
  const stdout = new CaptureOutput() as unknown as NodeJS.WriteStream;
  const instance = render(
    React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Timeline, { entries: entries(count), width: 100, maxLines }),
      React.createElement(Text, null, 'PROMPT-MARKER'),
    ),
    { stdout, exitOnCtrlC: false },
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  instance.unmount();
  await instance.waitUntilExit();
  return stripAnsi((stdout as unknown as CaptureOutput).frames.join(''));
}

test('the prompt below a long transcript is still rendered', async () => {
  const output = await frame(400, 20);
  assert.ok(
    output.includes('PROMPT-MARKER'),
    'a scrolling transcript must not push the surfaces below it off the terminal',
  );
});

test('a long transcript shows its newest rows, not its oldest', async () => {
  const output = await frame(400, 20);
  assert.ok(output.includes('entry 399'), 'the newest row must be visible');
  assert.ok(!output.includes('entry 0 '), 'the oldest row must not be in the live frame');
});

test('a short transcript renders every row', async () => {
  const output = await frame(3, 20);
  for (const index of [0, 1, 2]) {
    assert.ok(output.includes(`entry ${index}`), `entry ${index} must be visible`);
  }
  assert.ok(output.includes('PROMPT-MARKER'));
});
