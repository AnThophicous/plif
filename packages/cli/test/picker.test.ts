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
  auth: 'API key',
  reasoning: true,
  tools: true,
  detail: 'A long provider description',
};

async function pickerText(width = 100): Promise<string> {
  const stdout = new CaptureOutput();
  const app = render(
    React.createElement(Picker, {
      title: 'Select model',
      items: [model],
      filter: '',
      selected: 0,
      width,
    }),
    { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return stdout.output.replace(ANSI, '').replace(/\r/g, '');
}

test('model picker always exposes details without a hidden tab mode', async () => {
  const output = await pickerText();
  assert.match(output, /Search models/);
  assert.match(output, /Provider name/);
  assert.match(output, /Context\s+128k/);
  assert.match(output, /Access\s+API key/);
  assert.doesNotMatch(output, /Tab\s+details/);
});

test('wide model picker keeps list and details compactly bounded', async () => {
  const output = await pickerText(180);
  const detailLine = output.split('\n').find((line) => line.includes('Provider name'));
  assert.ok(detailLine);
  assert.ok(detailLine.length <= 112, `details escaped the bounded layout: ${detailLine.length}`);
});
