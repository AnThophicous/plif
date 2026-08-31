import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { Timeline } from '../src/components/Timeline.js';
import { render } from '../src/ui.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureStdout extends EventEmitter {
  columns = 80;
  rows = 70;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

test('timeline keeps settled thoughts and complete file code in the Slate viewport', async () => {
  const stdout = new CaptureStdout();
  const code = Array.from({ length: 8 }, (_, index) => `const line${index} = "FULL_CODE_${index}";`).join('\n');
  const app = render(
    React.createElement(Timeline, {
      entries: [
        {
          id: 'thought',
          kind: 'thinking',
          title: 'Thought',
          detail: 'first paragraph\nsecond paragraph\nthird paragraph',
          durationMs: 321,
          expand: true,
        },
        {
          id: 'edit',
          kind: 'tool',
          title: 'Edited',
          status: 'done',
          toolCategory: 'edit',
          fileCode: code,
          fileMode: 'editing',
          filePath: 'src/example.ts',
          fileAdded: 8,
          fileRemoved: 2,
        },
      ],
      width: 76,
      maxLines: 60,
    }),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 35));
  app.unmount();
  const output = stdout.output.replace(ANSI, '').replace(/\r/g, '');

  assert.match(output, /Thinked for: 321 ms/);
  assert.match(output, /first paragraph/);
  assert.match(output, /second paragraph/);
  assert.match(output, /FULL_CODE_7/);
  assert.match(output, /Editing - src\/example\.ts \(\+8 \| -2\)/);
});
