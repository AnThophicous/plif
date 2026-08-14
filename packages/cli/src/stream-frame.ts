export type StreamLane = 'answer' | 'reasoning' | 'completion';
export type StreamFrameKind = 'data' | 'complete' | 'reset' | 'dispose';

export interface StreamChange {
  readonly sequence: number;
  readonly lane: StreamLane;
  readonly delta: string;
}

export interface StreamFrame {
  readonly kind: StreamFrameKind;
  readonly epoch: number;
  readonly revision: number;
  readonly answer: string;
  readonly reasoning: string;
  readonly completionText: string;
  readonly lanes: readonly StreamLane[];
  readonly changes: readonly StreamChange[];
}

export interface StreamFrameClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface StreamAppend {
  readonly lane: StreamLane;
  readonly delta: string;
}

export interface StreamFrameSchedulerOptions {
  readonly onFrame: (frame: StreamFrame) => void;
  readonly clock?: StreamFrameClock;
  readonly frameMs?: number;
}

const systemClock: StreamFrameClock = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Lossless semantic storage with a bounded paint cadence.
 *
 * Canonical events remain outside this class. It keeps full immutable display
 * snapshots, so React never reconstructs text from whatever wire chunks happen
 * to land in one terminal frame.
 */
export class StreamFrameScheduler {
  readonly #clock: StreamFrameClock;
  readonly #frameMs: number;
  readonly #onFrame: (frame: StreamFrame) => void;

  #answer = '';
  #reasoning = '';
  #completionText = '';
  #changes: StreamChange[] = [];
  #dirty = new Set<StreamLane>();
  #epoch = 0;
  #revision = 0;
  #sequence = 0;
  #nextFrameAt = Number.NEGATIVE_INFINITY;
  #timer: unknown;
  #active = false;
  #disposed = false;

  constructor(options: StreamFrameSchedulerOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#frameMs = options.frameMs ?? 33;
    this.#onFrame = options.onFrame;
  }

  append(lane: StreamLane, delta: string): void {
    this.appendBatch([{ lane, delta }]);
  }

  appendBatch(appends: readonly StreamAppend[]): void {
    if (this.#disposed) throw new Error('stream frame scheduler is disposed');
    let changed = false;
    for (const append of appends) {
      if (!append.delta) continue;
      changed = true;
      this.#active = true;
      this.#dirty.add(append.lane);
      this.#changes.push(Object.freeze({
        sequence: this.#sequence++,
        lane: append.lane,
        delta: append.delta,
      }));
      if (append.lane === 'answer') this.#answer += append.delta;
      else if (append.lane === 'reasoning') this.#reasoning += append.delta;
      else this.#completionText += append.delta;
    }
    if (!changed) return;

    const now = this.#clock.now();
    if (this.#timer === undefined && now >= this.#nextFrameAt) {
      this.#emit('data', now);
      return;
    }
    this.#schedule();
  }

  /** Flush accepted output, then open a fresh epoch for the next model cycle. */
  flushAndComplete(): void {
    if (this.#disposed || !this.#active) return;
    this.#cancelTimer();
    this.#emit('complete', this.#clock.now());
    this.#clearData();
    this.#epoch += 1;
    this.#nextFrameAt = Number.NEGATIVE_INFINITY;
  }

  /** Drop every byte from an abandoned attempt and invalidate scheduled work. */
  discardAndReset(): void {
    if (this.#disposed) return;
    this.#cancelTimer();
    this.#clearData();
    this.#epoch += 1;
    this.#nextFrameAt = Number.NEGATIVE_INFINITY;
    this.#emit('reset', this.#clock.now());
  }

  /** Flush accepted output synchronously before the owner unmounts. */
  flushAndDispose(): void {
    if (this.#disposed) return;
    this.#cancelTimer();
    if (this.#active) this.#emit('dispose', this.#clock.now());
    this.#disposed = true;
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    const epoch = this.#epoch;
    const delay = Math.max(0, this.#nextFrameAt - this.#clock.now());
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = undefined;
      if (this.#disposed || epoch !== this.#epoch || this.#dirty.size === 0) return;
      this.#emit('data', this.#clock.now());
    }, delay);
  }

  #cancelTimer(): void {
    if (this.#timer === undefined) return;
    this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #emit(kind: StreamFrameKind, now: number): void {
    const lanes = Object.freeze([...this.#dirty]);
    const changes = Object.freeze([...this.#changes]);
    this.#dirty.clear();
    this.#changes = [];
    this.#nextFrameAt = now + this.#frameMs;
    const frame = Object.freeze({
      kind,
      epoch: this.#epoch,
      revision: ++this.#revision,
      answer: this.#answer,
      reasoning: this.#reasoning,
      completionText: this.#completionText,
      lanes,
      changes,
    });
    this.#onFrame(frame);
  }

  #clearData(): void {
    this.#answer = '';
    this.#reasoning = '';
    this.#completionText = '';
    this.#changes = [];
    this.#dirty.clear();
    this.#active = false;
  }
}
