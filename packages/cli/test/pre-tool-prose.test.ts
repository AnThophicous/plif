import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { preToolProseAction } from '../src/pre-tool-prose.js';

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
});
