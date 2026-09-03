import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activityColorAt,
  activityGlyphAt,
  activityGlyphWidthReport,
  activityKindForLabel,
  activityVisuals,
  gradientText,
  shimmerGradient,
  SHIMMER_PERIOD_MS,
} from '../src/activity-visuals.js';
import { displayWidth } from '../src/text.js';
import { color } from '../src/theme.js';

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

  it('keeps the glyph on the label gradient start color', () => {
    for (const [kind, visual] of Object.entries(activityVisuals) as Array<[keyof typeof activityVisuals, (typeof activityVisuals)[keyof typeof activityVisuals]]>) {
      assert.equal(activityColorAt(kind, 0), color(visual.gradient[0]), kind);
      assert.equal(activityColorAt(kind, 2_400), color(visual.gradient[0]), kind);
    }
  });

  it('matches the Decomposing glyph to the first letter of its gradient', () => {
    const kind = activityKindForLabel('Decomposing');
    const visual = activityVisuals[kind];
    const firstLetter = gradientText('Decomposing', visual.gradient[0], visual.gradient[1])[0];
    assert.equal(activityColorAt(kind, 1_200), firstLetter?.color);
  });

  it('maps labels semantically instead of choosing random glyphs', () => {
    assert.equal(activityKindForLabel('Searching files'), 'searching');
    assert.equal(activityKindForLabel('Compiling'), 'coding');
    assert.equal(activityKindForLabel('Reading package.json'), 'reading');
    assert.equal(activityKindForLabel('Brewing a plan'), 'cooking');
    assert.equal(activityKindForLabel('Reasoning'), 'reasoning');
  });


  it('routes the security, design and verification families before the generic ones', () => {
    assert.equal(activityKindForLabel('Auditing dependencies'), 'securing');
    assert.equal(activityKindForLabel('Tracing attack paths'), 'securing');
    assert.equal(activityKindForLabel('Hardening headers'), 'securing');
    assert.equal(activityKindForLabel('Choosing a palette'), 'designing');
    assert.equal(activityKindForLabel('Validating the IR'), 'verifying');
    assert.equal(activityKindForLabel('Prioritising findings'), 'planning');
    // The cooking family still wins its own phrasing even though it says plan.
    assert.equal(activityKindForLabel('Brewing a plan'), 'cooking');
    // And the pre-existing mappings did not move.
    assert.equal(activityKindForLabel('Reading package.json'), 'reading');
  });

  it('travels a highlight across the label without changing its text', () => {
    const value = 'Securing';
    const at = (ms: number) => shimmerGradient(value, 'accentDim', 'accent', ms);
    for (const ms of [0, 400, 900, 1_500, 2_300]) {
      assert.equal(at(ms).map((part) => part.text).join(''), value);
      assert.equal(at(ms).length, gradientText(value, 'accentDim', 'accent').length);
      assert.ok(at(ms).every((part) => /^#[0-9a-f]{6}$/i.test(part.color)), `${ms}`);
    }
    // The highlight actually moves: two phases of the same word differ.
    const early = at(200).map((part) => part.color).join();
    const later = at(1_300).map((part) => part.color).join();
    assert.notEqual(early, later);
  });

  it('repeats the shimmer exactly once per period', () => {
    const first = shimmerGradient('Verifying', 'accent', 'accentBright', 700);
    const next = shimmerGradient('Verifying', 'accent', 'accentBright', 700 + SHIMMER_PERIOD_MS);
    assert.deepEqual(next, first);
  });

  it('leaves characters outside the highlight on their static color', () => {
    const value = 'Designing';
    const base = gradientText(value, 'brand', 'accentBright');
    const lit = shimmerGradient(value, 'brand', 'accentBright', 0);
    // At phase zero the window sits before the word, so the tail is untouched.
    assert.deepEqual(lit.at(-1), base.at(-1));
  });

  it('applies a static grapheme-safe gradient to the word only', () => {
    const parts = gradientText('Reasoning', 'accentDim', 'accentBright');
    assert.equal(parts.map((part) => part.text).join(''), 'Reasoning');
    assert.equal(parts.length, 9);
    assert.equal(parts[0]?.color.length, 7);
    assert.equal(parts.at(-1)?.color.length, 7);
  });
});
