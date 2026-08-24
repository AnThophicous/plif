import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { render } from 'ink';
import React from 'react';
import { test } from 'node:test';

import { Picker } from '../src/components/Picker.js';
import { binaryStateIndicator } from '../src/theme.js';

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

test('binary setting rows use semantic check/X markers without ON/OFF labels', async () => {
  const stdout = new CaptureOutput();
  const app = render(
    React.createElement(Picker, {
      title: 'Agent settings',
      items: [
        { value: 'on', label: 'Automatic launch', state: 'on', current: true },
        { value: 'off', label: 'Manual launch only', state: 'off' },
      ],
      filter: '',
      selected: 0,
      width: 100,
    }),
    { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();
  const output = stdout.output.replace(ANSI, '').replace(/\r/g, '');

  assert.match(output, /✓ Automatic launch/);
  assert.match(output, /× Manual launch only/);
  assert.doesNotMatch(output, /\b(?:ON|OFF|ENABLED|DISABLED)\b/);
  assert.deepEqual(binaryStateIndicator('on'), { icon: '✓', tone: 'success' });
  assert.deepEqual(binaryStateIndicator('off'), { icon: '×', tone: 'danger' });
});
