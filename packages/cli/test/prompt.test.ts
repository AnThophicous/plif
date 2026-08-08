import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { layoutPrompt } from '../src/components/Prompt.js';

describe('multiline prompt layout', () => {
  it('uses the whole available width before soft-wrapping', () => {
    assert.deepEqual(layoutPrompt('abcdefghij', 10, 5).map((row) => row.text), ['abcde', 'fghij']);
  });

  it('preserves manual newlines', () => {
    assert.deepEqual(layoutPrompt('first\nsecond', 12, 20).map((row) => row.text), ['first', 'second']);
  });

  it('keeps an emoji cluster together at a wrap', () => {
    const dev = '🧑‍💻';
    assert.equal(layoutPrompt(`ab${dev}cd`, 2, 4)[0]?.text, `ab${dev}`);
  });

  it('keeps a cursor row after a trailing newline', () => {
    const rows = layoutPrompt('line\n', 5, 10);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.text, '');
    assert.equal(rows[1]?.cursor, 0);
  });
});
