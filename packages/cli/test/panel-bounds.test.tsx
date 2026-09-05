/**
 * The frame's load-bearing invariant: nothing the panel contains may be laid
 * out below the panel.
 *
 * The app frame is a fixed-height panel holding a column of
 * [transcript, spacer, prompt]. When that column had only `flexGrow` and no
 * height of its own it was measured against the content instead of the panel —
 * 104 rows inside a 25 row panel — the spacer expanded into the difference and
 * the prompt was placed at y=112, four screens below the terminal. The input
 * line vanished after resuming a session and came back only when the transcript
 * was short enough that the column happened to fit.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { Box, Text, render } from '../src/ui.js';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

const PANEL_HEIGHT = 12;
const FOOTER = 'PROMPT-AQUI';

class CaptureStdout extends EventEmitter {
  columns = 60;
  rows = PANEL_HEIGHT;
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

/**
 * The app frame in miniature.
 *
 * `bounded` is the fix: the inner column declares the panel's content height
 * instead of growing into whatever the parent offers.
 */
function frame(transcriptRows: number, bounded: boolean): React.ReactElement {
  const column = bounded
    ? { flexDirection: 'column' as const, height: PANEL_HEIGHT, flexShrink: 0 }
    : { flexDirection: 'column' as const, flexGrow: 1 };
  return React.createElement(
    Box,
    { flexDirection: 'column', height: PANEL_HEIGHT },
    React.createElement(
      Box,
      column,
      React.createElement(
        Box,
        // O timeline real tem teto: ele nunca passa do orcamento que recebeu.
        { flexDirection: 'column', height: PANEL_HEIGHT - 4, flexShrink: 0, overflow: 'hidden' },
        ...Array.from({ length: transcriptRows }, (_, index) =>
          React.createElement(Text, { key: index }, `transcript ${index}`),
        ),
      ),
      React.createElement(Box, { flexGrow: 1 }),
      React.createElement(
        Box,
        { flexDirection: 'column', flexShrink: 0 },
        React.createElement(Text, null, FOOTER),
      ),
    ),
  );
}

test('o prompt fica visível com um transcript curto', async () => {
  assert.match(await frameOf(frame(2, true)), new RegExp(FOOTER));
});

test('o prompt continua visível quando o transcript é maior que o painel', async () => {
  const saida = await frameOf(frame(40, true));
  assert.match(
    saida,
    new RegExp(FOOTER),
    'uma coluna com altura declarada não pode empurrar o prompt para fora do painel',
  );
});

test('o frame nunca é mais alto que o painel', async () => {
  const linhas = (await frameOf(frame(40, true)))
    .split('\n')
    .filter((line) => line.trim() !== '');
  assert.ok(
    linhas.length <= PANEL_HEIGHT,
    `o painel tem ${PANEL_HEIGHT} linhas e o frame desenhou ${linhas.length}`,
  );
});

/**
 * Characterises the failure this file exists to prevent.
 *
 * With only `flexGrow`, the column is measured against its content and the
 * spacer expands past the panel, taking the prompt with it. If Slate ever
 * bounds an unbounded column on its own this test will fail — and that is the
 * moment to revisit the explicit height in `app.tsx`, not to delete it blindly.
 */
test('sem altura declarada, a coluna leva o prompt para fora do painel', async () => {
  const saida = await frameOf(frame(40, false));
  assert.equal(
    new RegExp(FOOTER).test(saida),
    false,
    'se isto passar, o Slate mudou de comportamento e o motivo da correção mudou junto',
  );
});
