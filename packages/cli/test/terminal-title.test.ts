import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { completedTitle, titleForWorking } from '../src/terminal-title.js';

describe('terminal title', () => {
  it('keeps the window identity stable while the agent works', () => {
    assert.equal(completedTitle(), 'Plif-Code');
    assert.equal(titleForWorking('ignored'), 'Plif-Code');
  });
});
