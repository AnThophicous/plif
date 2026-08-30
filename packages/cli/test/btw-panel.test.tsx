import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { render } from '../src/ui.js';
import React from 'react';
import { test } from 'node:test';

import { BtwPanel, btwPanelHeight } from '../src/components/BtwPanel.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureOutput extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

test('BTW panel is visibly separate and never presents a secret value', async () => {
  const stdout = new CaptureOutput();
  const app = render(
    React.createElement(BtwPanel, {
      state: {
        id: 1,
        question: 'What is the next safe step?',
        phase: 'done',
        answer: 'Use /env set API_KEY; the value stays hidden.',
        startedAt: 100,
      },
      width: 100,
      now: 300,
    }),
    { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();

  const output = stdout.output.replace(ANSI, '').replace(/\r/g, '');
  assert.match(output, /BTW · answer/);
  assert.match(output, /separate/);
  assert.doesNotMatch(output, /super-secret/);
  assert.ok(btwPanelHeight(null, 'ask this', 100) > 0);
});
