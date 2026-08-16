import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { render } from 'ink';
import React from 'react';

import { Picker } from '../src/components/Picker.js';
import { activateTheme, MINIMAL_THEME } from '../src/themes.js';

class CaptureOutput extends EventEmitter {
  columns = 120;
  rows = 30;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

function plain(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

test('model picker keeps provider/model hierarchy readable at wide and narrow widths', async () => {
  activateTheme(MINIMAL_THEME);
  for (const width of [120, 52]) {
    const stdout = new CaptureOutput();
    stdout.columns = width;
    const instance = render(
      React.createElement(Picker, {
        title: 'MODELS',
        hint: 'Choose a provider first → then a model · ✓ marks the current choice',
        groups: [
          {
            id: 'openai',
            label: 'OpenAI',
            detail: 'hosted models',
            section: 'built into PLIF',
            current: true,
            items: [
              { value: 'gpt-5', label: 'GPT-5', current: true, badges: ['default'] },
              { value: 'gpt-4.1', label: 'GPT-4.1' },
            ],
          },
        ],
        expanded: ['openai'],
        filter: '',
        selected: 1,
        width,
        rows: 6,
      }),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const output = plain(stdout.output);
    assert.match(output, /MODELS/);
    assert.match(output, /PROVIDER/);
    assert.match(output, /MODEL/);
    assert.match(output, /ACTIVE/);
    assert.match(output, /Enter/);
    assert.match(output, /Esc/);
    instance.unmount();
  }
});
