import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyHashline, hashlineTag, parseHashline } from '../src/harness/hashline.js';

describe('hashline', () => {
  it('edits multiple original-line anchors without shifting later anchors', () => {
    const before = 'one\ntwo\nthree\nfour\n';
    const patch = parseHashline(`[\/project\/a.ts#${hashlineTag(before)}]\nSWAP 2:\n+TWO\nINS.POST 4:\n+five`);
    assert.equal(applyHashline(before, patch), 'one\nTWO\nthree\nfour\nfive\n');
  });

  it('refuses a patch after the observed snapshot changed', () => {
    const before = 'one\n';
    const patch = parseHashline(`[\/project\/a.ts#${hashlineTag(before)}]\nSWAP 1:\n+two`);
    assert.throws(() => applyHashline('changed\n', patch), /stale snapshot/);
  });
});
