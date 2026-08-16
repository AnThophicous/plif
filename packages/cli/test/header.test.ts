import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { render } from 'ink';
import React from 'react';

import { Header, headerHeight, headerPanelWidth } from '../src/components/Header.js';
import {
  PNG_HEADER_ART_HEIGHT,
  PNG_HEADER_ART_PIXEL_HEIGHT,
  PNG_HEADER_ART_WIDTH,
  pngHeaderCells,
} from '../src/components/PngHeaderArt.js';

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
    const cells = pngHeaderCells('#303030');
    assert.equal(PNG_HEADER_ART_WIDTH, 14);
    assert.equal(PNG_HEADER_ART_PIXEL_HEIGHT, 8);
    assert.equal(PNG_HEADER_ART_HEIGHT, 4);
    assert.equal(cells.length, PNG_HEADER_ART_HEIGHT);
    assert.ok(cells.every((row) => row.length === PNG_HEADER_ART_WIDTH));
    assert.ok(cells.some((row) => row.some((cell) => cell.foreground !== '#303030')));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === '▀')));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === ' ' && cell.background === undefined)));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === '▄')));
    const lowerOnly = cells.flat().find((cell) => cell.glyph === '▄');
    assert.equal(lowerOnly?.background, undefined);
  });

  it('reports its real footprint so the input frame stays in the viewport', () => {
    assert.equal(headerHeight(96), 13);
    assert.equal(headerHeight(60), 8);
    assert.equal(headerPanelWidth(96), 84);
    assert.equal(headerPanelWidth(180), 84);
    assert.equal(headerPanelWidth(60), 60);
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
