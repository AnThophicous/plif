import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { render } from 'ink';
import React from 'react';

import { HEADER_INFINITY, Header } from '../src/components/Header.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureStdout extends EventEmitter {
  columns = 96;
  rows = 12;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

describe('CLI header', () => {
  it('keeps the Plif mark, workspace, model, and operating cues in a stable order', async () => {
    const stdout = new CaptureStdout();
    const app = render(
      React.createElement(Header, {
        cwd: 'C:\\Users\\Elaine Araújo\\Documents\\Plif-Code',
        width: 96,
        model: 'claude-opus-5',
        effort: 'medium',
        version: '0.3.0',
      }),
      { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    app.unmount();

    const lines = stdout.output.replace(ANSI, '').replace(/\r/g, '').split('\n').filter(Boolean);
    const output = lines.join('\n');
    for (const line of HEADER_INFINITY.split('\n')) assert.match(output, new RegExp(line.trim().replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
    assert.match(output, /PLIF/);
    assert.ok(output.indexOf(HEADER_INFINITY.split('\n')[0]!.trim()) < output.indexOf('PLIF'));
    assert.match(output, /Code workspace/);
    assert.match(output, /claude-opus-5/);
    assert.match(output, /Ready to work/);
    assert.match(output, /Plan, work, review/);
  });
});
