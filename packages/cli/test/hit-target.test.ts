import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import React from 'react';

import { Box, Text, hitTargetLabels, render } from '../src/ui.js';

class SilentOutput extends EventEmitter {
  columns = 80;
  rows = 24;
  isTTY = true as const;
  write(): boolean {
    return true;
  }
}

/**
 * The mouse path for menus has no row arithmetic of its own: a component marks
 * an element with a label, Slate hit-tests the click against the laid-out tree,
 * and the app reads the label back. These cover the half that does not need a
 * terminal — that the label reaches the registry, and that it leaves with the
 * component, so a stale label can never answer for a row that is gone.
 */
test('a labelled element registers its hit target, and gives it up on unmount', async () => {
  const stdout = new SilentOutput() as unknown as NodeJS.WriteStream;
  const row = (label: string, text: string): React.ReactElement =>
    React.createElement(Box, { hitTarget: label }, React.createElement(Text, null, text));
  const instance = render(
    React.createElement(
      Box,
      { flexDirection: 'column' },
      row('picker:row:0', 'first'),
      row('picker:row:1', 'second'),
    ),
    { stdout, exitOnCtrlC: false },
  );

  assert.ok(hitTargetLabels().includes('picker:row:0'));
  assert.ok(hitTargetLabels().includes('picker:row:1'));

  instance.unmount();
  await instance.waitUntilExit();
  assert.equal(hitTargetLabels().includes('picker:row:0'), false);
  assert.equal(hitTargetLabels().includes('picker:row:1'), false);
});
