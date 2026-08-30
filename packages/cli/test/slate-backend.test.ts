import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import React, { useState } from 'react';

import { render, Text, useInput } from '../src/ui.js';

class CaptureStdout extends EventEmitter {
  columns = 48;
  rows = 16;
  isTTY = true as const;
  writes: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }
}

class TypedStdin extends Readable {
  isTTY = true as const;

  override _read(): void {}

  setRawMode(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[\d;?]*[ -/]*[@-~]/g, '');
}

function BackendProbe({ received }: { readonly received: string[] }): React.ReactElement {
  const [value, setValue] = useState('');
  useInput((char) => {
    received.push(char);
    setValue((current) => current + char);
  });
  return React.createElement(Text, null, value || 'ready');
}

test('Slate routes each typed character once and deduplicates terminal frames', async () => {
  const stdout = new CaptureStdout();
  const stdin = new TypedStdin();
  const received: string[] = [];
  const app = render(
    React.createElement(BackendProbe, { received }),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const initialWrites = stdout.writes.length;
    stdin.push('a');
    stdin.push('b');
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(received, ['a', 'b']);
    assert.ok(stdout.writes.length > initialWrites);
    assert.equal(
      stdout.writes.filter((frame) => frame.includes('\u001b[2J')).length,
      1,
      'the Slate controller should clear only the initial frame',
    );

    const latest = stripAnsi(stdout.writes.at(-1) ?? '');
    assert.equal(latest.split('\n').filter((line) => line.includes('ab')).length, 1);
  } finally {
    app.unmount();
  }
});
