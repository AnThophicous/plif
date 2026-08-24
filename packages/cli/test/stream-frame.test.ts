import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  StreamFrameScheduler,
  type StreamFrame,
  type StreamFrameClock,
} from '../src/stream-frame.js';

class FakeFrameClock implements StreamFrameClock {
  #now = 0;
  #nextId = 1;
  #timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(Number(handle));
  }

  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      this.#timers.delete(id);
      this.#now = timer.at;
      timer.callback();
    }
    this.#now = end;
  }
}

function harness(): {
  clock: FakeFrameClock;
  frames: StreamFrame[];
  stream: StreamFrameScheduler;
} {
  const clock = new FakeFrameClock();
  const frames: StreamFrame[] = [];
  return {
    clock,
    frames,
    stream: new StreamFrameScheduler({ clock, onFrame: (frame) => frames.push(frame) }),
  };
}

describe('StreamFrameScheduler', () => {
  it('emits the first semantic data immediately and coalesces a burst', () => {
    const { clock, frames, stream } = harness();
    stream.appendBatch([
      { lane: 'answer', delta: 'x' },
      { lane: 'completion', delta: 'x' },
    ]);
    for (let index = 1; index < 200; index += 1) {
      stream.appendBatch([
        { lane: 'answer', delta: 'x' },
        { lane: 'completion', delta: 'x' },
      ]);
    }

    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.answer, 'x');
    clock.advance(33);
    assert.equal(frames.length, 2);
    assert.equal(frames[1]?.answer, 'x'.repeat(200));
    assert.equal(frames[1]?.completionText, 'x'.repeat(200));
    assert.ok(Object.isFrozen(frames[1]));
    assert.ok(Object.isFrozen(frames[1]?.changes));
  });

  it('preserves reasoning, answer, completion text, and change ordering', () => {
    const { clock, frames, stream } = harness();
    stream.append('reasoning', 'why');
    stream.append('answer', 'so');
    stream.append('completion', 'whyso');
    clock.advance(33);

    assert.equal(frames.at(-1)?.reasoning, 'why');
    assert.equal(frames.at(-1)?.answer, 'so');
    assert.equal(frames.at(-1)?.completionText, 'whyso');
    assert.deepEqual(frames.at(-1)?.changes.map((change) => change.lane), [
      'answer',
      'completion',
    ]);
  });

  it('discards a failed epoch and prevents its timer painting the next one', () => {
    const { clock, frames, stream } = harness();
    stream.append('answer', 'old');
    stream.append('answer', ' abandoned');
    stream.discardAndReset();

    assert.equal(frames.at(-1)?.kind, 'reset');
    assert.equal(frames.at(-1)?.epoch, 1);
    assert.equal(frames.at(-1)?.answer, '');
    clock.advance(100);
    assert.equal(frames.length, 2);

    stream.append('answer', 'new');
    assert.equal(frames.at(-1)?.epoch, 1);
    assert.equal(frames.at(-1)?.answer, 'new');
  });

  it('flushes pending accepted output exactly once on completion', () => {
    const { clock, frames, stream } = harness();
    stream.append('answer', 'a');
    stream.append('answer', 'b');
    stream.flushAndComplete();

    assert.equal(frames.at(-1)?.kind, 'complete');
    assert.equal(frames.at(-1)?.answer, 'ab');
    const revisions = frames.map((frame) => frame.revision);
    assert.equal(new Set(revisions).size, revisions.length);
    clock.advance(100);
    assert.deepEqual(frames.map((frame) => frame.revision), revisions);
  });

  it('returns the canonical final snapshot when completion races the last paint', () => {
    const { frames, stream } = harness();
    stream.append('answer', 'fast ');
    stream.append('answer', 'answer');
    const finalFrame = stream.flushAndComplete();

    assert.equal(finalFrame?.kind, 'complete');
    assert.equal(finalFrame?.answer, 'fast answer');
    assert.equal(frames.at(-1)?.answer, 'fast answer');
  });

  it('flushes pending accepted output before disposal and rejects later appends', () => {
    const { clock, frames, stream } = harness();
    stream.append('reasoning', 'a');
    stream.append('reasoning', 'b');
    stream.flushAndDispose();

    assert.equal(frames.at(-1)?.kind, 'dispose');
    assert.equal(frames.at(-1)?.reasoning, 'ab');
    clock.advance(100);
    assert.throws(() => stream.append('answer', 'late'), /disposed/);
  });

  it('can flush from a shared terminal clock without creating its own timer', () => {
    const { clock, frames } = harness();
    const stream = new StreamFrameScheduler({
      clock,
      clockDriven: true,
      frameMs: 33,
      onFrame: (frame) => frames.push(frame),
    });

    stream.append('answer', 'first');
    stream.append('answer', ' second');
    assert.equal(frames.length, 1);

    clock.advance(32);
    stream.tick();
    assert.equal(frames.length, 1);
    clock.advance(1);
    stream.tick();
    assert.equal(frames.at(-1)?.answer, 'first second');
    assert.equal(frames.length, 2);
  });
});
