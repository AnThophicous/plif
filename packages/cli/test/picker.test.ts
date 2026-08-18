import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { render } from 'ink';
import React from 'react';
import { test } from 'node:test';

import { Picker } from '../src/components/Picker.js';

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

const model = {
  value: 'provider/model',
  label: 'Model name',
  provider: 'Provider name',
  context: '128k',
  capabilities: ['reasoning', 'vision'],
  auth: 'key required',
  detail: 'A long provider description',
};

async function pickerText(details: boolean): Promise<string> {
  const stdout = new CaptureOutput();
  const app = render(
    React.createElement(Picker, {
      title: 'Select model',
      items: [model],
      filter: '',
      selected: 0,
      details,
      width: 100,
    }),
    { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return stdout.output.replace(ANSI, '').replace(/\r/g, '');
}

test('model picker keeps secondary provider metadata in contextual details', async () => {
  const list = await pickerText(false);
  assert.match(list, /Model name/);
  assert.doesNotMatch(list, /Provider name|128k|key required/);

  const detail = await pickerText(true);
  assert.match(detail, /Provider name/);
  assert.match(detail, /key required/);
});
