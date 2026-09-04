/**
 * A sibling below an overflowing block must survive.
 *
 * This is the shape of the whole app frame: a fixed-height panel holding a
 * transcript that is taller than its own viewport, and, below it, the prompt.
 * When the transcript overflowed, the prompt stopped being drawn — the input
 * line vanished the moment a resumed session was taller than the window.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { Box, ScrollView, Text, render } from '../src/ui.js';

const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureStdout extends EventEmitter {
  columns = 60;
  rows = 12;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

async function frameOf(tree: React.ReactElement): Promise<string> {
  const stdout = new CaptureStdout();
  const app = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 60));
  app.unmount();
  return stdout.output.replace(ANSI, '').replace(/\r/g, '');
}

/** A panel of `height` rows: `rows` lines of content in a `viewport`-tall scroll, then a footer. */
function panel(height: number, viewport: number, rows: number): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: 'column', height },
    React.createElement(
      Box,
      { flexDirection: 'column', height: viewport, flexShrink: 0 },
      React.createElement(
        ScrollView,
        { flexDirection: 'column', height: viewport, overflow: 'scroll' as const },
        ...Array.from({ length: rows }, (_, index) =>
          React.createElement(Text, { key: index }, `linha ${index}`),
        ),
      ),
    ),
    React.createElement(Box, { flexGrow: 1 }),
    React.createElement(
      Box,
      { flexDirection: 'column', flexShrink: 0 },
      React.createElement(Text, null, 'RODAPE-VISIVEL'),
    ),
  );
}

test('o rodapé sobrevive quando o conteúdo cabe no viewport', async () => {
  const frame = await frameOf(panel(10, 4, 3));
  assert.match(frame, /linha 0/);
  assert.match(frame, /RODAPE-VISIVEL/);
});

test('o rodapé sobrevive quando o conteúdo transborda o viewport', async () => {
  const frame = await frameOf(panel(10, 4, 40));
  assert.match(
    frame,
    /RODAPE-VISIVEL/,
    'um irmão abaixo de um bloco que transborda não pode desaparecer: é assim que o prompt some',
  );
});

test('o viewport não cresce além da altura declarada', async () => {
  const frame = await frameOf(panel(10, 4, 40));
  const linhas = frame.split('\n').filter((line) => /^linha \d+/.test(line.trim()));
  assert.ok(
    linhas.length <= 4,
    `o scroll declarou 4 linhas e desenhou ${linhas.length}; o excedente é pago pelo prompt`,
  );
});
