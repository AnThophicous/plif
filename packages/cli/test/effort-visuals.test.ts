import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  effortDisplay,
  effortPulseCells,
  effortSymbol,
  effortTagline,
  effortTone,
  effortVisual,
} from '../src/effort-visuals.js';
import { PLIF_WAVE_STOPS } from '../src/pulse.js';
import { displayWidth } from '../src/text.js';

describe('effort visual identities', () => {
  it('keeps every animation frame at a stable terminal width', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode', 'plif']) {
      const first = effortPulseCells(effort, 0, true);
      const later = effortPulseCells(effort, 720, true);
      assert.ok(first.length > 0, effort);
      assert.equal(first.length, later.length, effort);
      assert.equal(
        displayWidth(first.map((cell) => cell.text).join('')),
        displayWidth(later.map((cell) => cell.text).join('')),
        effort,
      );
    }
  });

  it('keeps the glyph geometry fixed while its light moves', () => {
    const first = effortPulseCells('ultracode', 0, true);
    const later = effortPulseCells('ultracode', 720, true);
    assert.equal(first.map((cell) => cell.text).join(''), later.map((cell) => cell.text).join(''));
    assert.notDeepEqual(first, later);
  });

  it('gives the high-impact efforts distinct identities', () => {
    assert.equal(effortVisual('max').descriptor, 'deep reasoning');
    assert.equal(effortVisual('ultra').descriptor, 'wide search');
    assert.equal(effortVisual('ultracode').descriptor, 'code synthesis');
    assert.equal(effortVisual('plif').descriptor, 'adaptive reasoning');
  });

  it('gives PLIF a distinct display signature', () => {
    assert.equal(effortSymbol('plif'), '');
    assert.equal(effortDisplay('plif'), 'PLIF');
    assert.notEqual(effortSymbol('plif'), effortSymbol('max'));
  });

  it('keeps the PLIF accent wave inside the accent family from its first stop', () => {
    assert.ok(!PLIF_WAVE_STOPS.includes('brand'));
    assert.ok(!PLIF_WAVE_STOPS.includes('muted'));
    assert.equal(PLIF_WAVE_STOPS[0], 'accentDim');
  });

  it('reserves the full pink identity for PLIF and steps the rest up the neutral ramp', () => {
    assert.equal(effortTone('plif'), 'accentBright');
    assert.equal(effortTone('max'), 'accentBright');
    assert.equal(effortTone('low'), 'faint');
    // PLIF's travelling light passes through champagne; no other level does.
    assert.ok(effortVisual('plif').stops.includes('accentPastel'));
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']) {
      assert.ok(!effortVisual(effort).stops.includes('accentPastel'), effort);
    }
  });

  it('falls back safely for an absent or unknown effort', () => {
    assert.equal(effortVisual(undefined).id, 'default');
    assert.equal(effortVisual('future-mode').id, 'default');
    assert.equal(effortTagline('ultracode', false), 'code ready');
    assert.equal(effortTagline('ultracode', true), 'synthesizing code');
  });
});
