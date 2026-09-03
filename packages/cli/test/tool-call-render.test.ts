import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { ToolCall } from '../src/components/ToolCall.js';
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

const DIFF = [
  '--- a/notes.txt',
  '+++ b/notes.txt',
  '@@ -0,0 +1,2 @@',
  '+first line',
  '+second line',
].join('\n');

async function renderToolCall(props: Partial<React.ComponentProps<typeof ToolCall>>): Promise<string> {
  const stdout = new CaptureOutput() as unknown as NodeJS.WriteStream;
  const instance = render(
    React.createElement(ToolCall, {
      name: 'Edited',
      target: 'notes.txt',
      ok: true,
      running: false,
      width: 90,
      ...props,
    } as React.ComponentProps<typeof ToolCall>),
    { stdout, exitOnCtrlC: false },
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  instance.unmount();
  await instance.waitUntilExit();
  return stripAnsi((stdout as unknown as CaptureOutput).frames.join(""));
}

/**
 * A completed edit with a structured diff must not also show the tool's raw
 * new-content preview underneath it.
 *
 * Both used to render unconditionally whenever the tool call carried both a
 * diff and the file's new content (as an ordinary `edit_file` completion
 * does): the coloured, line-numbered `Diff`, immediately followed by
 * `FileActivity`'s own, differently-numbered preview of the same content with
 * no +/- markers. Two summaries of one edit, in two incompatible styles, is
 * what read as duplicated or corrupted output.
 */
test('a completed edit with a diff does not also render the raw code preview', async () => {
  const text = await renderToolCall({
    diff: DIFF,
    code: 'first line\nsecond line\n',
    codeMode: 'editing',
    codePath: 'notes.txt',
    codeAdded: 2,
    codeRemoved: 0,
  });

  // The diff itself is present…
  assert.ok(text.includes('first line'));
  assert.ok(text.includes('Added 2 lines'));
  // …but FileActivity's own headline for the same edit is not, because that
  // headline only exists on the block this fix now suppresses.
  assert.ok(!text.includes('lines to notes.txt'));
  assert.ok(!/\bUpdated notes\.txt\b/.test(text));
});

/** A tool with no diff at all still gets its live code preview. */
test('a tool with no diff still shows the code preview', async () => {
  const text = await renderToolCall({
    code: 'created content\n',
    codeMode: 'creating',
    codePath: 'fresh.txt',
    codeAdded: 1,
    codeRemoved: 0,
  });
  assert.ok(text.includes('created content'));
  assert.ok(text.includes('Wrote 1 line to fresh.txt') || text.includes('fresh.txt'));
});
