import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activityGlyphAt,
  activityGlyphWidthReport,
  activityKindForLabel,
  activityVisuals,
  gradientText,
} from '../src/activity-visuals.js';
import { displayWidth } from '../src/text.js';

describe('semantic activity visuals', () => {
  it('keeps every registry frame one terminal cell wide', () => {
    for (const report of activityGlyphWidthReport()) {
      assert.ok(report.glyphs.length >= 2, report.kind);
      assert.ok(report.widths.every((width) => width === 1), `${report.kind}: ${report.widths}`);
    }
  });

  it('keeps the visual family stable while an activity is running', () => {
    for (const kind of Object.keys(activityVisuals) as Array<keyof typeof activityVisuals>) {
      const still = activityGlyphAt(kind, 0, false);
      assert.equal(activityGlyphAt(kind, 0, false), still);
      assert.equal(activityGlyphAt(kind, 2_400, false), still);
      assert.equal(displayWidth(still), 1, kind);
    }
    assert.notEqual(activityGlyphAt('reasoning', 0), activityGlyphAt('reasoning', 600));
  });

  it('maps labels semantically instead of choosing random glyphs', () => {
    assert.equal(activityKindForLabel('Searching files'), 'searching');
    assert.equal(activityKindForLabel('Compiling'), 'coding');
    assert.equal(activityKindForLabel('Reading package.json'), 'reading');
    assert.equal(activityKindForLabel('Brewing a plan'), 'cooking');
    assert.equal(activityKindForLabel('Reasoning'), 'reasoning');
  });

  it('applies a static grapheme-safe gradient to the word only', () => {
    const parts = gradientText('Reasoning', 'accentDim', 'accentBright');
    assert.equal(parts.map((part) => part.text).join(''), 'Reasoning');
    assert.equal(parts.length, 9);
    assert.equal(parts[0]?.color.length, 7);
    assert.equal(parts.at(-1)?.color.length, 7);
  });
});
