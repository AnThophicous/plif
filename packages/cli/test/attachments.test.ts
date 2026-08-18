import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Attachment } from '@plif/core';

import { attachmentsForPrimaryModel, hasImageAttachments } from '../src/attachments.js';

const text: Attachment = { kind: 'text', name: '[Pasted Content #1]', text: 'full text' };
const image: Attachment = { kind: 'image', name: '[Pasted Image #1]', mediaType: 'image/png', data: 'AQI=' };

describe('primary model attachment routing', () => {
  it('keeps images for a declared vision model', () => {
    assert.deepEqual(attachmentsForPrimaryModel([text, image], true), [text, image]);
  });

  it('holds images back from text-only primary models', () => {
    assert.deepEqual(attachmentsForPrimaryModel([text, image], false), [text]);
    assert.equal(hasImageAttachments([text, image]), true);
    assert.equal(hasImageAttachments([text]), false);
  });
});
