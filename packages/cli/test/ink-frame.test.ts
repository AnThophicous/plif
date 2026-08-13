import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import React from 'react';
import { render } from 'ink';

import { SessionHeader } from '../src/components/SessionHeader.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function finalFrame(output: string): string {
  const clear = '\u001b[2J';
  const frame = output.includes(clear) ? output.slice(output.lastIndexOf(clear) + clear.length) : output;
  return frame.replace(ANSI, '').replace(/\r/g, '');
}

async function capture(width: number): Promise<string> {
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(stdout, {
    columns: { value: width, configurable: true },
    rows: { value: 24, configurable: true },
    isTTY: { value: true, configurable: true },
  });
  let output = '';
  stdout.on('data', (chunk) => { output += chunk.toString(); });
  const instance = render(React.createElement(SessionHeader, {
    version: '0.3.0',
    cwd: 'C:\\src\\plif',
    model: 'openai/gpt-5',
    provider: 'openai',
    sandboxGaps: ['filesystem write block unavailable'],
    width,
  }), { stdout, patchConsole: false, exitOnCtrlC: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  instance.unmount();
  return finalFrame(output);
}

describe('Ink frame hierarchy', () => {
  it('normalizes to the final clear-screen frame', () => {
    assert.equal(finalFrame(`old\u001b[2Jnew`), 'new');
  });

  for (const width of [28, 80, 140]) {
    it(`renders a bounded ${width}-column opening cell`, async () => {
      const frame = await capture(width);
      assert.match(frame, /Plif/);
      assert.match(frame, /0\.3\.0/);
      assert.match(frame, /filesystem/);
      assert.match(frame, /unavailable/);
      assert.ok(frame.split('\n').every((line) => [...line].length <= width));
    });
  }
});
