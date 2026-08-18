import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLIF_ACTIVATION_DURATION_MS,
  PLIF_ACTIVATION_LOGO_MS,
  PLIF_ACTIVATION_SPIN_MS,
  plifActivationFrame,
} from '../src/components/PlifActivation.js';

describe('PLIF effort activation', () => {
  it('accelerates into a peak, then reveals and fades the existing logo', () => {
    const start = plifActivationFrame(0);
    const middle = plifActivationFrame(PLIF_ACTIVATION_SPIN_MS - 1);
    const peak = plifActivationFrame(PLIF_ACTIVATION_SPIN_MS);
    const fading = plifActivationFrame(PLIF_ACTIVATION_SPIN_MS + PLIF_ACTIVATION_LOGO_MS + 100);
    const done = plifActivationFrame(PLIF_ACTIVATION_DURATION_MS);

    assert.equal(start.spinning, true);
    assert.equal(middle.spinning, true);
    assert.equal(peak.peak, true);
    assert.equal(peak.logoOpacity, 1);
    assert.ok(fading.logoOpacity > 0 && fading.logoOpacity < 1);
    assert.equal(done.logoOpacity, 0);
  });

  it('keeps all activation glyphs one display cell wide', () => {
    const frames = [0, 300, 550, 770, 1_050, 1_349, 1_350, 2_099].map(plifActivationFrame);
    assert.ok(frames.every((frame) => [...frame.glyph].length === 1));
  });
});

