import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLIF_GLYPHS,
  plifGlyphAt,
  plifGlyphFrames,
  plifGlyphPeriodMs,
  plifGlyphStops,
  thinkingDotsAt,
} from '../src/plif-glyphs.js';
import { displayWidth } from '../src/text.js';
import { supportsRichGlyphs } from '../src/theme.js';

describe('premium PLIF glyph system', () => {
  it('keeps every constellation family one terminal cell wide', () => {
    for (const role of ['quiet', 'subtle', 'active', 'thinking', 'peak', 'loading'] as const) {
      assert.ok(plifGlyphFrames(role).every((glyph) => displayWidth(glyph) === 1), role);
    }
  });

  it('uses distinct glyph families for quiet, active and peak states', () => {
    assert.notDeepEqual(plifGlyphFrames('quiet'), plifGlyphFrames('active'));
    assert.notDeepEqual(plifGlyphFrames('active'), plifGlyphFrames('peak'));
    assert.notEqual(plifGlyphAt(0, 'active'), plifGlyphAt(600, 'active'));
  });

  it('keeps the thinking dot progression width stable', () => {
    const dots = [thinkingDotsAt(0), thinkingDotsAt(520), thinkingDotsAt(1_040)];
    assert.deepEqual(dots, ['.  ', '.. ', '...']);
    assert.equal(new Set(dots.map(displayWidth)).size, 1);
  });

  it('routes PLIF light through the canonical pink highlights', () => {
    assert.ok(plifGlyphStops('active').includes('accentStrong'));
    assert.ok(plifGlyphStops('active').includes('accentPastel'));
    assert.ok(!plifGlyphStops('quiet').includes('accentStrong'));
  });

  it('uses one optical loading family with a synchronized centre peak', () => {
    assert.strictEqual(
      plifGlyphFrames('loading'),
      supportsRichGlyphs ? PLIF_GLYPHS.rich.loading : PLIF_GLYPHS.ascii.loading,
    );
    const frames = plifGlyphFrames('loading');
    assert.equal(frames.length, 2);
    assert.notEqual(frames[0], frames[1]);
    assert.ok(!supportsRichGlyphs || frames.every((frame) => ['✦', '✧'].includes(frame)));
    assert.ok(frames.every((frame) => displayWidth(frame) === 1));
    assert.equal(plifGlyphPeriodMs('loading'), 1_440);
  });

  it('keeps each activity family as a matched two-frame pair', () => {
    for (const role of ['subtle', 'active', 'thinking', 'bloom'] as const) {
      const frames = plifGlyphFrames(role);
      assert.equal(frames.length, 2, role);
      assert.ok(frames.every((frame) => displayWidth(frame) === 1), role);
    }
  });
});
