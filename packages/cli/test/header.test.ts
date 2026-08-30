import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { Box, render, Static } from '../src/ui.js';
import React from 'react';

import {
  Header,
  HEADER_MAX_WIDTH,
  headerHeight,
  headerWidth,
} from '../src/components/Header.js';
import {
  PNG_HEADER_ART_HEIGHT,
  PNG_HEADER_ART_PIXEL_HEIGHT,
  PNG_HEADER_ART_WIDTH,
  pngHeaderCells,
} from '../src/components/PngHeaderArt.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureStdout extends EventEmitter {
  columns: number;
  rows = 40;
  isTTY = true as const;
  output = '';

  constructor(columns = 96) {
    super();
    this.columns = columns;
  }

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

describe('CLI header', () => {
  it('rasterizes the supplied transparent PNG into stable terminal cells', () => {
    const cells = pngHeaderCells('#191b20');
    assert.equal(PNG_HEADER_ART_WIDTH, 16);
    assert.equal(PNG_HEADER_ART_PIXEL_HEIGHT, 14);
    assert.equal(PNG_HEADER_ART_HEIGHT, 7);
    assert.equal(cells.length, PNG_HEADER_ART_HEIGHT);
    assert.ok(cells.every((row) => row.length === PNG_HEADER_ART_WIDTH));
    assert.ok(cells.some((row) => row.some((cell) => cell.foreground !== '#191b20')));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === '▀')));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === ' ' && cell.background === undefined)));
    assert.ok(cells.some((row) => row.some((cell) => cell.glyph === '▄')));
  });

  it('reports its real footprint so the input frame stays in the viewport', async () => {
    assert.equal(headerHeight(96), 10);
    assert.equal(headerHeight(74), 10);
    assert.equal(headerHeight(16), 10);

    for (const width of [96, 73]) {
      const stdout = new CaptureStdout(width);
      const app = render(
        React.createElement(Header, {
          width,
        }),
        { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      app.unmount();

      const output = stdout.output.replace(ANSI, '').replace(/\r/g, '');
      assert.equal(output.slice(0, -1).split('\n').length, headerHeight(width));
    }
  });

  it('centers the identity block with Ink layout at wide terminal widths', async () => {
    const stdout = new CaptureStdout(120);
    const app = render(
      React.createElement(Header, {
        width: 120,
      }),
      { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    app.unmount();

    const output = stdout.output.replace(ANSI, '').replace(/\r/g, '');
    const wordmarkLine = output.split('\n').find((line) => line.includes('PLIF')) ?? '';
    assert.equal(headerWidth(120), HEADER_MAX_WIDTH);
    assert.equal(wordmarkLine.indexOf('PLIF'), (120 - 4) / 2);
  });

  it('keeps the wordmark and startup copy centered inside a quiet outline', async () => {
    const stdout = new CaptureStdout();
    const app = render(
      React.createElement(Header, {
        width: 96,
      }),
      { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    app.unmount();

    const lines = stdout.output.replace(ANSI, '').replace(/\r/g, '').split('\n').filter(Boolean);
    const output = lines.join('\n');
    const wordmarkLine = lines.findIndex((line) => line.includes('PLIF'));
    const outlineLine = lines.findIndex((line) => line.includes('╭'));
    assert.ok(wordmarkLine >= 0 && outlineLine > wordmarkLine);
    assert.match(output, /│/);
    assert.match(output, /Ready to work/);
    assert.match(output, /Describe a task/);
    assert.doesNotMatch(output, /Code workspace|claude-opus-5|0\.3\.0|Documents|Plan, work, review|Ctrl\+T/);
    assert.match(output, /╭.*╮/);
    assert.match(output, /╰.*╯/);
  });

  it('keeps the header centered when emitted as an append-only Static row', async () => {
    const stdout = new CaptureStdout(120);
    const app = render(
      React.createElement(
        Box,
        { width: 120 },
        React.createElement(
          Static,
          { items: [{ id: 'header' }] },
          () => React.createElement(
            Box,
            { key: 'header', width: 120, paddingX: 2 },
            React.createElement(Header, { width: 116 }),
          ),
        ),
      ),
      { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    app.unmount();

    const lines = stdout.output.replace(ANSI, '').replace(/\r/g, '').split('\n');
    const outlineLine = lines.find((line) => line.includes('╭')) ?? '';
    assert.equal(outlineLine.indexOf('╭'), (120 - HEADER_MAX_WIDTH) / 2);
  });
});
