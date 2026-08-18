import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { wrapPastedText } from '../src/components/PastedTextDialog.js';

describe('pasted text dialog layout', () => {
  it('keeps explicit line breaks and reports clipping', () => {
    assert.deepEqual(wrapPastedText('alpha\nbeta\ngamma', 20, 2), {
      lines: ['alpha', 'beta'],
      truncated: true,
    });
  });

  it('wraps long clipboard lines without splitting surrogate pairs', () => {
    const result = wrapPastedText('ab🧑‍💻cd', 4, 4);
    assert.deepEqual(result.lines, ['ab🧑‍💻', 'cd']);
    assert.equal(result.truncated, false);
  });
});
