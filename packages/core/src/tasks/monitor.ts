/**
 * Runtime watcher for work that may outlive the tool call that started it.
 *
 * The monitor is deliberately independent from React and from the agent loop.
 * A task can wake it through an event subscription; a bounded, adaptive timer
 * is only a safety net for task kinds that cannot emit events. Nothing in this
 * class calls a model or writes a transcript row.
 */

export type TaskMonitorCheckResult<T> =
  | { readonly state: 'unchanged' }
  | { readonly state: 'progress'; readonly data?: T; readonly fingerprint?: string }
  | { readonly state: 'completed'; readonly result?: T }
  | { readonly state: 'cancelled' }
  | { readonly state: 'failed'; readonly error: unknown };

export type TaskMonitorStatus = 'completed' | 'failed' | 'cancelled' | 'timed_out';

export interface TaskMonitorResult<T> {
  readonly id: string;
  readonly kind: string;
  readonly sessionId: string;
  readonly status: TaskMonitorStatus;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly result?: T;
  readonly progress?: T;
  readonly error?: unknown;
}

export interface TaskMonitorTask<T> {
  readonly id: string;
  readonly kind: string;
  readonly sessionId: string;
  readonly check: () => Promise<TaskMonitorCheckResult<T>>;
  /** Subscribe to a task-native wakeup. Return the unsubscribe function. */
  readonly subscribe?: (wake: () => void) => () => void;
  /** Abort the underlying operation when waiting is cancelled or times out. */
  readonly cancel?: () => Promise<void> | void;
}

export interface TaskMonitorOptions<T = unknown> {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly initialPollMs?: number;
  readonly maxPollMs?: number;
  readonly backoff?: number;
  /** Return true only when a progress snapshot is actionable to the agent. */
  readonly onProgress?: (data: T | undefined, fingerprint?: string) => boolean;
  /** Called only for diagnostics; it must not be used to drive UI state. */
  readonly debug?: (event: TaskMonitorDebugEvent) => void;
  /** Override sleeping in deterministic tests. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<'elapsed' | 'aborted'>;
  readonly now?: () => number;
}

export interface TaskMonitorDebugEvent {
  readonly type: 'created' | 'check' | 'wake' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  readonly id: string;
  readonly kind: string;
  readonly sessionId: string;
  readonly pollMs?: number;
}

interface Active<T> {
  readonly task: TaskMonitorTask<T>;
  readonly startedAt: number;
  readonly promise: Promise<TaskMonitorResult<T>>;
  readonly controller: AbortController;
}

const DEFAULT_INITIAL_POLL_MS = 1_500;
const DEFAULT_MAX_POLL_MS = 10_000;
const DEFAULT_BACKOFF = 1.5;

export class TaskMonitor {
  #active = new Map<string, Active<unknown>>();

  watch<T>(task: TaskMonitorTask<T>, options: TaskMonitorOptions<T> = {}): Promise<TaskMonitorResult<T>> {
    const existing = this.#active.get(task.id) as Active<T> | undefined;
    if (existing) return existing.promise;

    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    const startedAt = (options.now ?? Date.now)();
    const debug = options.debug ?? (() => undefined);
    debug({ type: 'created', id: task.id, kind: task.kind, sessionId: task.sessionId });

    const promise = this.#run(task, controller, startedAt, options)
      .finally(() => {
        options.signal?.removeEventListener('abort', onAbort);
        this.#active.delete(task.id);
      });
    const active: Active<T> = { task, startedAt, promise, controller };
    this.#active.set(task.id, active as Active<unknown>);
    return promise;
  }

  async cancel(id: string): Promise<boolean> {
    const active = this.#active.get(id);
    if (!active) return false;
    active.controller.abort();
    await active.promise;
    return true;
  }

  async stopAll(): Promise<void> {
    const active = [...this.#active.values()];
    for (const item of active) item.controller.abort();
    await Promise.allSettled(active.map((item) => item.promise));
  }

  has(id: string): boolean {
    return this.#active.has(id);
  }

  async #run<T>(
    task: TaskMonitorTask<T>,
    controller: AbortController,
    startedAt: number,
    options: TaskMonitorOptions<T>,
  ): Promise<TaskMonitorResult<T>> {
    const now = options.now ?? Date.now;
    const debug = options.debug ?? (() => undefined);
    const timeoutAt = options.timeoutMs === undefined ? undefined : startedAt + Math.max(0, options.timeoutMs);
    const maxPollMs = Math.max(1, options.maxPollMs ?? DEFAULT_MAX_POLL_MS);
    const backoff = Math.max(1, options.backoff ?? DEFAULT_BACKOFF);
    let pollMs = Math.max(1, options.initialPollMs ?? DEFAULT_INITIAL_POLL_MS);
    let lastFingerprint: string | undefined;

    while (true) {
      if (controller.signal.aborted) {
        await task.cancel?.();
        return await this.#finish(task, 'cancelled', startedAt, undefined, undefined, options);
      }
      if (timeoutAt !== undefined && now() >= timeoutAt) {
        await task.cancel?.();
        return await this.#finish(task, 'timed_out', startedAt, undefined, new Error('task monitor timed out'), options);
      }

      debug({ type: 'check', id: task.id, kind: task.kind, sessionId: task.sessionId, pollMs });
      let result: TaskMonitorCheckResult<T>;
      try {
        result = await task.check();
      } catch (error) {
        return await this.#finish(task, 'failed', startedAt, undefined, error, options);
      }

      if (result.state === 'completed') return await this.#finish(task, 'completed', startedAt, result.result, undefined, options);
      if (result.state === 'cancelled') return await this.#finish(task, 'cancelled', startedAt, undefined, undefined, options);
      if (result.state === 'failed') return await this.#finish(task, 'failed', startedAt, undefined, result.error, options);
      if (result.state === 'progress') {
        const changed = result.fingerprint === undefined || result.fingerprint !== lastFingerprint;
        if (result.fingerprint !== undefined) lastFingerprint = result.fingerprint;
        if (changed && options.onProgress?.(result.data, result.fingerprint) === true) {
          return await this.#finish(task, 'completed', startedAt, result.data, undefined, options);
        }
      }

      const waitMs = timeoutAt === undefined ? pollMs : Math.max(1, Math.min(pollMs, timeoutAt - now()));
      const wake = await this.#waitForWake(task, controller.signal, waitMs, options.wait);
      if (wake === 'aborted') {
        await task.cancel?.();
        return await this.#finish(task, 'cancelled', startedAt, undefined, undefined, options);
      }
      if (wake === 'event') debug({ type: 'wake', id: task.id, kind: task.kind, sessionId: task.sessionId });
      pollMs = Math.min(maxPollMs, Math.max(pollMs + 1, Math.ceil(pollMs * backoff)));
    }
  }

  async #finish<T>(
    task: TaskMonitorTask<T>,
    status: TaskMonitorStatus,
    startedAt: number,
    result: T | undefined,
    error: unknown,
    options: TaskMonitorOptions<T>,
  ): Promise<TaskMonitorResult<T>> {
    const endedAt = (options.now ?? Date.now)();
    const debug = options.debug ?? (() => undefined);
    debug({ type: status === 'timed_out' ? 'timed_out' : status, id: task.id, kind: task.kind, sessionId: task.sessionId });
    return {
      id: task.id,
      kind: task.kind,
      sessionId: task.sessionId,
      status,
      startedAt,
      endedAt,
      ...(result === undefined ? {} : { result }),
      ...(error === undefined ? {} : { error }),
    };
  }

  async #waitForWake(
    task: TaskMonitorTask<unknown>,
    signal: AbortSignal,
    delayMs: number,
    waitOverride?: TaskMonitorOptions['wait'],
  ): Promise<'elapsed' | 'event' | 'aborted'> {
    if (!task.subscribe) {
      return waitOverride ? await waitOverride(delayMs, signal) : await defaultWait(delayMs, signal);
    }

    return await new Promise<'elapsed' | 'event' | 'aborted'>((resolve) => {
      let settled = false;
      let off: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (value: 'elapsed' | 'event' | 'aborted'): void => {
        if (settled) return;
        settled = true;
        off?.();
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = (): void => settle('aborted');
      off = task.subscribe?.(() => settle('event'));
      if (settled) {
        off?.();
        return;
      }
      timer = setTimeout(() => settle('elapsed'), delayMs);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) settle('aborted');
    });
  }
}

function defaultWait(ms: number, signal: AbortSignal): Promise<'elapsed' | 'aborted'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve('elapsed');
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve('aborted');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
