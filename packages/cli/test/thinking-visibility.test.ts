import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { TimelineRow } from '../src/components/Timeline.js';
import { entry } from '../src/session.js';
import { render } from '../src/ui.js';

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

async function renderRow(row: ReturnType<typeof entry>): Promise<string> {
  const stdout = new CaptureOutput() as unknown as NodeJS.WriteStream;
  const instance = render(
    React.createElement(TimelineRow, { entry: row, width: 90 }),
    { stdout, exitOnCtrlC: false },
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  instance.unmount();
  await instance.waitUntilExit();
  return stripAnsi((stdout as unknown as CaptureOutput).frames.join(''));
}

/**
 * Plif's standing rule is that it never silently drops content from the
 * transcript: any fold has to say how much is hidden and how to get it back.
 * A settled thought folds its body away by default (only Ctrl+R or a click
 * bring it back), and until now nothing on that line said either existed —
 * "Thought for 9s" and nothing else read as the reasoning having vanished.
 */
test('a settled thought with content says how to get it back', async () => {
  const text = await renderRow(entry('thinking', 'Thinking', {
    detail: 'The user asked a simple question; a short reply is enough.',
    status: undefined,
    durationMs: 9200,
  }));
  assert.ok(text.includes('Thinking for 9.2s'));
  assert.ok(text.includes('Ctrl+R'));
});

test('an empty thought has nothing to point back to', async () => {
  const text = await renderRow(entry('thinking', 'Thinking', {
    detail: '',
    status: undefined,
    durationMs: 1000,
  }));
  assert.equal(text.includes('Ctrl+R'), false);
});

test('a thought still in progress does not advertise a hint that only applies once it settles', async () => {
  const text = await renderRow(entry('thinking', 'Thinking', {
    detail: 'partial reasoning already streamed in',
    status: 'active',
  }));
  assert.equal(text.includes('Ctrl+R'), false);
});
