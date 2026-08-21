import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { render } from 'ink';
import React, { useEffect } from 'react';

import { Header } from '../src/components/Header.js';
import { useTerminalSize } from '../src/hooks/useTerminalSize.js';
import { detachImmediateInkResize, RESIZE_SETTLE_MS } from '../src/terminal-resize.js';
import type { TerminalSize } from '../src/terminal-resize.js';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

class ResizeStdout extends EventEmitter {
  isTTY = true as const;
  writes: string[] = [];

  constructor(public columns: number, public rows: number) {
    super();
  }

  write(chunk: string | Uint8Array): boolean {
    this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }
}

function ResponsiveHeader({
  onSize,
  onMount,
}: {
  readonly onSize: (size: TerminalSize) => void;
  readonly onMount: () => void;
}): React.ReactElement {
  const size = useTerminalSize();

  useEffect(() => onSize(size), [onSize, size]);
  useEffect(() => {
    onMount();
  }, [onMount]);

  return React.createElement(Header, {
    width: size.columns,
  });
}

function latestWordmark(stdout: ResizeStdout): string {
  for (const write of [...stdout.writes].reverse()) {
    const wordmark = write
      .replace(ANSI, '')
      .replace(/\r/g, '')
      .split('\n')
      .find((line) => line.includes('PLIF'));
    if (wordmark) return wordmark;
  }
  return '';
}

function assertHeaderCentered(stdout: ResizeStdout): void {
  const wordmark = latestWordmark(stdout);
  assert.ok(wordmark, `missing header wordmark at ${stdout.columns} columns`);
  assert.equal(wordmark.indexOf('PLIF'), Math.floor((stdout.columns - 4) / 2));
  assert.match(stdout.writes.join('').replace(ANSI, ''), /╭.*╮/);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSize(
  sizes: readonly TerminalSize[],
  columns: number,
  rows: number,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const current = sizes.at(-1);
    if (current?.columns === columns && current.rows === rows) return;
    await sleep(10);
  }
  assert.fail(`terminal size did not reach ${columns}x${rows}`);
}

describe('reactive terminal dimensions', () => {
  it('tracks repeated column/row changes, keeps the header mounted, and cleans up', async () => {
    const stdout = new ResizeStdout(120, 40);
    const sizes: TerminalSize[] = [];
    let mounts = 0;
    const onSize = (size: TerminalSize): void => {
      sizes.push(size);
    };
    const onMount = (): void => {
      mounts += 1;
    };
    const before = new Set(
      stdout.listeners('resize') as Array<(...args: unknown[]) => void>,
    );
    const app = render(
      React.createElement(ResponsiveHeader, { onSize, onMount }),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );

    try {
      await sleep(20);
      detachImmediateInkResize(stdout as unknown as NodeJS.WriteStream, before);
      assert.equal(stdout.listenerCount('resize'), 1, 'Plif should own one resize listener');
      assertHeaderCentered(stdout);

      stdout.resize(80, 30);
      await waitForSize(sizes, 80, 30);
      await sleep(35);
      assertHeaderCentered(stdout);

      stdout.resize(40, 12);
      await waitForSize(sizes, 40, 12);
      await sleep(35);
      assertHeaderCentered(stdout);

      stdout.resize(70, 18);
      stdout.resize(85, 24);
      stdout.resize(100, 35);
      await waitForSize(sizes, 100, 35);
      await sleep(RESIZE_SETTLE_MS);
      assertHeaderCentered(stdout);

      stdout.resize(100, 10);
      await waitForSize(sizes, 100, 10);
      assert.equal(mounts, 1, 'resize must not remount the responsive tree');
    } finally {
      app.unmount();
      await sleep(20);
    }
    assert.equal(stdout.listenerCount('resize'), 0);
  });
});
