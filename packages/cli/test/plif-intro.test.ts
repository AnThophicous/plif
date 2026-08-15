import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cubicEaseInOut,
  cubicEaseOut,
  PLIF_ASCII_ART,
  plifIntroFrame,
  PLIF_INTRO_DURATION_MS,
} from '../src/components/PlifIntro.js';

describe('Plif effort entrance', () => {
  it('keeps the large PLIF wordmark separate from the static header art', () => {
    assert.equal(PLIF_ASCII_ART.length, 9);
    assert.equal(PLIF_ASCII_ART[0], '▄███████▄  ▄█        ▄█     ▄████████');
    assert.equal(PLIF_ASCII_ART.at(-1), '            ▀');
  });

  it('uses a fast cubic launch and a soft landing', () => {
    assert.equal(cubicEaseOut(0), 0);
    assert.equal(cubicEaseOut(1), 1);
    assert.ok(cubicEaseOut(0.25) > 0.25);
    assert.equal(cubicEaseInOut(0), 0);
    assert.equal(cubicEaseInOut(1), 1);
  });

  it('moves up while shrinking and then fades without changing layout height', () => {
    const start = plifIntroFrame(0, 40);
    const middle = plifIntroFrame(PLIF_INTRO_DURATION_MS * 0.55, 40);
    const end = plifIntroFrame(PLIF_INTRO_DURATION_MS, 40);

    assert.ok(middle.top < start.top);
    assert.ok(middle.largeOpacity < start.largeOpacity);
    assert.ok(middle.compactOpacity > start.compactOpacity);
    assert.equal(end.top, 0);
    assert.equal(end.largeOpacity, 0);
    assert.equal(end.compactOpacity, 0);
  });
});
