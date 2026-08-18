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

  it('reserves the one warm tone for PLIF and steps the rest up the cold ramp', () => {
    assert.equal(effortTone('plif'), 'gold');
    assert.equal(effortTone('max'), 'accentBright');
    assert.equal(effortTone('low'), 'faint');
    // PLIF's travelling light passes through champagne; no other level does.
    assert.ok(effortVisual('plif').stops.includes('gold'));
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']) {
      assert.ok(!effortVisual(effort).stops.includes('gold'), effort);
    }
  });

  it('falls back safely for an absent or unknown effort', () => {
    assert.equal(effortVisual(undefined).id, 'default');
    assert.equal(effortVisual('future-mode').id, 'default');
    assert.equal(effortTagline('ultracode', false), 'code ready');
    assert.equal(effortTagline('ultracode', true), 'synthesizing code');
  });
});
