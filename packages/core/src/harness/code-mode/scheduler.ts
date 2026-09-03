/**
 * The scheduler a program's tool calls run through.
 *
 * A program that says `await Promise.all([read(a), read(b), read(c)])` has
 * asked for exactly what the native loop already grants a parallel-safe batch,
 * so it gets the same contract rather than a second, weaker one: parallel-safe
 * calls overlap up to a cap, anything else takes the lane alone, and both start
 * in submission order.
 *
 * Two orderings are kept apart on purpose. The *program* is answered the moment
 * its call settles — holding a resolved read hostage to a slower sibling would
 * serialise the concurrency the program asked for. The *record* of each call is
 * committed head-of-line, in submission order, so the transcript and the audit
 * log read in the order the program wrote, not in the order the disk answered.
 */

import type { CodeDispatchRecord } from './types.js';

export interface DispatchOutcome {
  readonly ok: boolean;
  readonly output: string;
  readonly diff?: string;
}

export interface DispatchSchedulerOptions {
  readonly maxParallel: number;
  readonly maxCalls: number;
  /** Mirrors `Tool.parallelSafe`; an unknown tool is treated as exclusive. */
  readonly isParallelSafe: (name: string) => boolean;
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) => Promise<DispatchOutcome>;
  /** Called once per call, in submission order, after it settles. */
  readonly onCommit: (record: CodeDispatchRecord) => void;
  /** Prefix for nested call ids, normally the `run_code` call's own id. */
  readonly callIdPrefix: string;
  readonly signal?: AbortSignal;
}

interface Entry {
  readonly seq: number;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly settle: (outcome: DispatchOutcome) => void;
}

/** Raised when a program asks for more calls than the run allows. */
export class DispatchLimitError extends Error {
  constructor(limit: number) {
    super(`this run_code program exceeded its budget of ${limit} tool calls`);
    this.name = 'DispatchLimitError';
  }
}

export class DispatchScheduler {
  readonly #options: DispatchSchedulerOptions;
  readonly #queue: Entry[] = [];
  readonly #settled = new Map<number, CodeDispatchRecord>();
  readonly #wakeups: (() => void)[] = [];
  #submitted = 0;
  #running = 0;
  #driving = false;
  #commitCursor = 0;
  #closed = false;
  #inFlight = 0;
  #idleWaiters: (() => void)[] = [];

  constructor(options: DispatchSchedulerOptions) {
    this.#options = options;
  }

  get dispatched(): number {
    return this.#submitted;
  }

  /**
   * Queue one call and resolve when it settles.
   *
   * A refusal is thrown rather than returned because the program's SDK contract
   * is that a call which cannot happen raises — a budget overrun that came back
   * as `{ ok: false }` would read to the program as a tool that failed, and it
   * would retry the call that was refused for being one call too many.
   */
  submit(name: string, args: Record<string, unknown>): Promise<DispatchOutcome> {
    if (this.#closed) {
      return Promise.reject(
        new Error(`the run is over; "${name}" was not dispatched`),
      );
    }
    if (this.#submitted >= this.#options.maxCalls) {
      return Promise.reject(new DispatchLimitError(this.#options.maxCalls));
    }
    const seq = this.#submitted;
    this.#submitted += 1;
    this.#inFlight += 1;
    return new Promise<DispatchOutcome>((resolve) => {
      this.#queue.push({ seq, name, args, settle: resolve });
      void this.#drive();
    });
  }

  /** Stop accepting work and resolve once everything already started has settled. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const entry of this.#queue.splice(0)) {
      this.#record(entry, { ok: false, output: 'Error: the run ended before this call started' }, 0);
      entry.settle({ ok: false, output: 'Error: the run ended before this call started' });
      this.#inFlight -= 1;
    }
    if (this.#inFlight === 0) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  #wake(): void {
    for (const wake of this.#wakeups.splice(0)) wake();
  }

  #sleep(): Promise<void> {
    return new Promise<void>((resolve) => this.#wakeups.push(resolve));
  }

  async #drive(): Promise<void> {
    if (this.#driving) return;
    this.#driving = true;
    try {
      while (this.#queue.length > 0) {
        const next = this.#queue[0] as Entry;
        const exclusive = !this.#options.isParallelSafe(next.name);
        if (exclusive) {
          // An exclusive call holds the lane through its own commit, so the
          // record of a write always lands between the records of the reads
          // that surrounded it.
          if (this.#running > 0) {
            await this.#sleep();
            continue;
          }
          this.#queue.shift();
          await this.#run(next);
          continue;
        }
        if (this.#running >= this.#options.maxParallel) {
          await this.#sleep();
          continue;
        }
        this.#queue.shift();
        void this.#run(next);
      }
    } finally {
      this.#driving = false;
    }
  }

  async #run(entry: Entry): Promise<void> {
    this.#running += 1;
    const startedAt = Date.now();
    const callId = `${this.#options.callIdPrefix}:code:${entry.seq + 1}`;
    let outcome: DispatchOutcome;
    try {
      outcome = this.#options.signal?.aborted
        ? { ok: false, output: 'Error: cancelled' }
        : await this.#options.dispatch(entry.name, entry.args, callId);
    } catch (error) {
      outcome = {
        ok: false,
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      this.#running -= 1;
    }
    this.#record(entry, outcome, Date.now() - startedAt, callId);
    entry.settle(outcome);
    this.#inFlight -= 1;
    if (this.#inFlight === 0) {
      for (const resolve of this.#idleWaiters.splice(0)) resolve();
    }
    this.#wake();
    void this.#drive();
  }

  /**
   * Hold a settled call until every earlier one has been committed.
   *
   * Without the cursor a fast read submitted second would be recorded before a
   * slow read submitted first, and the audit log would describe an execution
   * order the program never expressed.
   */
  #record(entry: Entry, outcome: DispatchOutcome, durationMs: number, callId?: string): void {
    this.#settled.set(entry.seq, {
      id: callId ?? `${this.#options.callIdPrefix}:code:${entry.seq + 1}`,
      name: entry.name,
      args: entry.args,
      ok: outcome.ok,
      durationMs,
      output: outcome.output,
      ...(outcome.diff !== undefined ? { diff: outcome.diff } : {}),
    });
    while (this.#settled.has(this.#commitCursor)) {
      const record = this.#settled.get(this.#commitCursor) as CodeDispatchRecord;
      this.#settled.delete(this.#commitCursor);
      this.#commitCursor += 1;
      this.#options.onCommit(record);
    }
  }
}
