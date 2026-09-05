import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

import { nextRevealed } from '../src/components/Timeline.js';

describe('streamed answer reveal', () => {
  it('always moves forward and never past the end', () => {
    for (const length of [1, 2, 3, 17, 400, 9_000]) {
      let revealed = 0;
      let frames = 0;
      while (revealed < length) {
        const next = nextRevealed(revealed, length);
        assert.ok(next > revealed, `stalled at ${revealed} of ${length}`);
        assert.ok(next <= length, `overshot to ${next} of ${length}`);
        revealed = next;
        frames += 1;
        assert.ok(frames < 10_000, `never converged for ${length}`);
      }
    }
  });

  it('catches up on a large arrival without crawling through it', () => {
    // A model that hands over a whole paragraph at once must not take longer to
    // draw it than the model took to write it. At 60 Hz these bounds are about
    // a second for a long answer, which reads as writing rather than waiting.
    let revealed = 0;
    let frames = 0;
    while (revealed < 4_000) {
      revealed = nextRevealed(revealed, 4_000);
      frames += 1;
    }
    assert.ok(frames < 70, `took ${frames} frames to reveal 4000 characters`);
  });

  it('finishes the last characters instead of halving forever', () => {
    // The proportional step rounds to nothing near the end; without the floor a
    // short answer would never quite finish.
    assert.equal(nextRevealed(9, 10), 10);
    assert.equal(nextRevealed(10, 10), 10);
    assert.equal(nextRevealed(11, 10), 10);
  });

  it('shows a settled answer whole rather than animating history', () => {
    const source = fs.readFileSync(new URL('../src/components/Timeline.tsx', import.meta.url), 'utf8');
    // The reveal is for text still being written. An entry that is no longer
    // active has to render complete, or scrollback would replay the animation.
    assert.match(source, /if \(!streaming\) revealed\.current = text\.length;/);
    assert.match(source, /const source = useSmoothReveal\(body, streaming\);/);
  });
});

describe('reveal layout agreement', () => {
  it('never withholds more than the timeline reserves height for', () => {
    const source = fs.readFileSync(new URL('../src/components/Timeline.tsx', import.meta.url), 'utf8');
    // The window sizes every row from the entry's full text. Text the row holds
    // back is height that was reserved and not drawn, which reads as a gap or a
    // clipped tail while the answer streams.
    assert.match(source, /const REVEAL_MAX_LAG = \d+;/);
    assert.match(
      source,
      /if \(text\.length - revealed\.current > REVEAL_MAX_LAG\) revealed\.current = text\.length - REVEAL_MAX_LAG;/,
    );
  });

  it('steps on a frame budget rather than on every tick of the 8 ms clock', () => {
    const source = fs.readFileSync(new URL('../src/components/Timeline.tsx', import.meta.url), 'utf8');
    assert.match(source, /const REVEAL_FRAME_MS = 16;/);
    assert.match(source, /if \(now - steppedAt\.current >= REVEAL_FRAME_MS\)/);
  });
});
