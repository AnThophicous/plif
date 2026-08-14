import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { render } from 'ink';
import React from 'react';

import { layoutPrompt, Prompt } from '../src/components/Prompt.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureStdout extends EventEmitter {
  columns = 40;
  rows = 12;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

describe('multiline prompt layout', () => {
  it('renders the input inside the restored rounded frame', async () => {
    const stdout = new CaptureStdout();
    const app = render(
      React.createElement(Prompt, {
        value: '/',
        cursor: 1,
        placeholder: '/ for commands',
        focused: true,
        busy: false,
        busyLabel: '',
        width: 40,
      }),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    app.unmount();
    const output = stdout.output.replace(ANSI, '').replace(/\r/g, '');
    assert.match(output, /❯ \//);
    assert.match(output, /[\u256d\u256e\u2570\u2571\u2502]/);
  });

  it('uses the whole available width before soft-wrapping', () => {
    assert.deepEqual(layoutPrompt('abcdefghij', 10, 5).map((row) => row.text), ['abcde', 'fghij']);
  });

  it('preserves manual newlines', () => {
    assert.deepEqual(layoutPrompt('first\nsecond', 12, 20).map((row) => row.text), ['first', 'second']);
  });

  it('keeps an emoji cluster together at a wrap', () => {
    const dev = '🧑‍💻';
    assert.equal(layoutPrompt(`ab${dev}cd`, 2, 4)[0]?.text, `ab${dev}`);
  });

  it('keeps a cursor row after a trailing newline', () => {
    const rows = layoutPrompt('line\n', 5, 10);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.text, '');
    assert.equal(rows[1]?.cursor, 0);
  });
});
