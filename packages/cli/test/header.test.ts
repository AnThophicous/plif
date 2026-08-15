import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { render } from 'ink';
import React from 'react';

import { Header, headerHeight } from '../src/components/Header.js';
import { PNG_HEADER_ART_HEIGHT, PNG_HEADER_ART_WIDTH, pngHeaderCells } from '../src/components/PngHeaderArt.js';

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
  it('rasterizes the supplied transparent PNG into stable terminal cells', () => {
    const cells = pngHeaderCells('#191b20');
    assert.equal(PNG_HEADER_ART_WIDTH, 22);
    assert.equal(PNG_HEADER_ART_HEIGHT, 11);
    assert.equal(cells.length, PNG_HEADER_ART_HEIGHT);
    assert.ok(cells.every((row) => row.length === PNG_HEADER_ART_WIDTH));
    assert.ok(cells.some((row) => row.some((cell) => cell.foreground !== '#191b20')));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === '▀')));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === ' ' && cell.background === undefined)));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === '▄')));
  });

  it('reports its real footprint so the input frame stays in the viewport', () => {
    assert.equal(headerHeight(96), 20);
    assert.equal(headerHeight(60), 8);
  });

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
    assert.match(output, /PLIF/);
    assert.match(output, /Code workspace/);
    assert.match(output, /claude-opus-5/);
    assert.match(output, /Ready to work/);
    assert.match(output, /Plan, work, review/);
  });
});
