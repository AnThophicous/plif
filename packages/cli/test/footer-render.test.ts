import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { Footer } from '../src/components/Footer.js';
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

/**
 * The footer used to be a four-sided round-bordered box drawn under the
 * prompt on every busy frame. Plif's own visual direction is light chrome and
 * rules rather than full boxes — a border that says nothing the text inside
 * it does not already say is exactly the decoration that direction rules out.
 * This checks the replacement rule-and-line shape stays that way.
 */
test('the status footer is a rule and a line, not a bordered box', async () => {
  const stdout = new CaptureOutput() as unknown as NodeJS.WriteStream;
  const instance = render(
    React.createElement(Footer, {
      hints: [],
      width: 80,
      provider: 'OpenCode',
      providerId: 'opencode',
      model: 'glm-5.3-flash',
      effort: 'default',
      contextUsed: 4000,
      contextMax: 100_000,
    }),
    { stdout, exitOnCtrlC: false },
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  instance.unmount();
  await instance.waitUntilExit();
  const text = stripAnsi((stdout as unknown as CaptureOutput).frames.join(''));

  assert.ok(text.includes('glm-5.3-flash'));
  assert.ok(text.includes('ctx'));
  // No round-box corner or side characters anywhere in the frame.
  for (const boxChar of ['╭', '╮', '╰', '╯']) {
    assert.equal(text.includes(boxChar), false, `unexpected border character ${boxChar}`);
  }
});
