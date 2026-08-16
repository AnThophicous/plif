import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { render, Text } from 'ink';
import React, { useMemo } from 'react';

import { Footer } from '../src/components/Footer.js';
import { Header } from '../src/components/Header.js';
import { TimelineRow } from '../src/components/Timeline.js';
import { AnimationClockProvider, useAnimationFrame } from '../src/hooks/useAnimationClock.js';

class CaptureStdout extends EventEmitter {
  columns = 120;
  rows = 30;
  isTTY = true as const;
  write(_chunk: string | Uint8Array): boolean { return true; }
}

describe('static shell render isolation', () => {
  it('does not repaint header or footer for an unrelated animation tick', async () => {
    const stdout = new CaptureStdout();
    let parentRenders = 0;

    function Probe(): React.ReactElement {
      useAnimationFrame(true, 'fast');
      parentRenders += 1;
      const hints = useMemo(() => [
        { key: 'Enter', label: 'run' },
        { key: '/', label: 'commands' },
      ], []);
      return (
        <>
          <Header cwd="C:\\workspace" width={120} model="deepseek-v4-flash" effort="plif" version="0.3.0" />
          <Footer hints={hints} width={120} />
          <Text>{parentRenders}</Text>
        </>
      );
    }

    const app = render(
      <AnimationClockProvider active>
        <Probe />
      </AnimationClockProvider>,
      { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    app.unmount();

    assert.ok(parentRenders > 1, `expected animation ticks, got ${parentRenders} parent renders`);
    assert.equal((Header as unknown as { readonly $$typeof?: symbol }).$$typeof, Symbol.for('react.memo'));
    assert.equal((Footer as unknown as { readonly $$typeof?: symbol }).$$typeof, Symbol.for('react.memo'));
    assert.equal((TimelineRow as unknown as { readonly $$typeof?: symbol }).$$typeof, Symbol.for('react.memo'));
  });
});
