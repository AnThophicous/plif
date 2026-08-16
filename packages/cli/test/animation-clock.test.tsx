import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { render, Text } from 'ink';
import React from 'react';

import {
  AnimationClockProvider,
  useAnimationFrame,
} from '../src/hooks/useAnimationClock.js';

class CaptureStdout extends EventEmitter {
  columns = 80;
  rows = 10;
  isTTY = true as const;
  write(_chunk: string | Uint8Array): boolean {
    return true;
  }
}

function Probe({ active, onRender }: { active: boolean; onRender: () => void }): React.ReactElement {
  useAnimationFrame(active);
  onRender();
  return <Text>{active ? 'active' : 'inactive'}</Text>;
}

function FastProbe({ onRender }: { onRender: () => void }): React.ReactElement {
  useAnimationFrame(true, 'fast');
  onRender();
  return <Text>fast</Text>;
}

describe('animation clock subscriptions', () => {
  it('does not repaint inactive indicators on every clock tick', async () => {
    const stdout = new CaptureStdout();
    let inactiveRenders = 0;
    let activeRenders = 0;
    const app = render(
      <AnimationClockProvider active intervalMs={2}>
        <Probe active={false} onRender={() => { inactiveRenders += 1; }} />
        <Probe active onRender={() => { activeRenders += 1; }} />
      </AnimationClockProvider>,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 24));
    app.unmount();
    const activeRendersAtUnmount = activeRenders;
    await new Promise<void>((resolve) => setTimeout(resolve, 12));

    assert.equal(inactiveRenders, 1);
    assert.ok(activeRenders > 1);
    assert.equal(activeRenders, activeRendersAtUnmount);
  });

  it('gives visual pulse consumers a faster clock than idle spinners', async () => {
    const stdout = new CaptureStdout();
    let fastRenders = 0;
    const app = render(
      <AnimationClockProvider active intervalMs={120}>
        <FastProbe onRender={() => { fastRenders += 1; }} />
      </AnimationClockProvider>,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 110));
    app.unmount();

    assert.ok(fastRenders > 2, `expected the visual clock to tick above the 120ms clock, got ${fastRenders} renders`);
  });
});
