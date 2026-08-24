import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compactPlifReviewCheckpoint, preToolProseAction } from '../src/pre-tool-prose.js';

describe('pre-tool prose presentation', () => {
  it('drops clipped prose from the visible timeline', () => {
    assert.deepEqual(
      preToolProseAction('answer-1', 'Vou verificar o arquivo em', 'transient'),
      { type: 'drop', id: 'answer-1' },
    );
  });

  it('turns complete prose into a compact completed activity', () => {
    assert.deepEqual(
      preToolProseAction('answer-1', 'Vou verificar o arquivo primeiro.', 'activity'),
      {
        type: 'update',
        id: 'answer-1',
        patch: {
          kind: 'step',
          title: 'Preparing',
          detail: 'Vou verificar o arquivo primeiro.',
          tone: 'faint',
          status: 'done',
        },
      },
    );
  });

  it('collapses a verbose PLIF review receipt without hiding ordinary prose', () => {
    assert.equal(
      compactPlifReviewCheckpoint('Review gate satisfied with evidence from every changed file and fresh validation.'),
      'Review checkpoint complete',
    );
    assert.equal(
      compactPlifReviewCheckpoint('I will inspect the authentication flow before editing it.'),
      null,
    );
    assert.deepEqual(
      preToolProseAction(
        'answer-1',
        'Review checkpoint complete',
        'activity',
        'Review',
      ),
      {
        type: 'update',
        id: 'answer-1',
        patch: {
          kind: 'step',
          title: 'Review',
          detail: 'Review checkpoint complete',
          tone: 'faint',
          status: 'done',
        },
      },
    );
  });
});
