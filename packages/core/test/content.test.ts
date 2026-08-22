import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ContentDeltaNormalizer, ContentProtocolError } from '../src/model/content.js';

describe('content stream normalization', () => {
  it('preserves legitimate repeated delta text', () => {
    const normalizer = new ContentDeltaNormalizer();
    assert.equal(normalizer.push({ text: 'Asp', semantics: 'delta' }), 'Asp');
    assert.equal(normalizer.push({ text: 'Asp', semantics: 'delta' }), 'Asp');
    assert.equal(normalizer.value, 'AspAsp');
  });

  it('turns cumulative snapshots into one visible answer', () => {
    const normalizer = new ContentDeltaNormalizer();
    assert.equal(normalizer.push({ text: 'O', semantics: 'snapshot' }), 'O');
    assert.equal(normalizer.push({ text: 'Olá', semantics: 'snapshot' }), 'lá');
    assert.equal(normalizer.push({ text: 'Olá mundo', semantics: 'snapshot' }), ' mundo');
    assert.equal(normalizer.value, 'Olá mundo');
  });

  it('handles unicode snapshots without corrupting the suffix', () => {
    const normalizer = new ContentDeltaNormalizer();
    assert.equal(normalizer.push({ text: 'Olá 👋', semantics: 'snapshot' }), 'Olá 👋');
    assert.equal(normalizer.push({ text: 'Olá 👋 mundo', semantics: 'snapshot' }), ' mundo');
  });

  it('rejects a rewritten snapshot instead of silently duplicating it', () => {
    const normalizer = new ContentDeltaNormalizer();
    normalizer.push({ text: 'original', semantics: 'snapshot' });
    assert.throws(
      () => normalizer.push({ text: 'revised', semantics: 'snapshot' }),
      (error: unknown) => error instanceof ContentProtocolError,
    );
  });
});
