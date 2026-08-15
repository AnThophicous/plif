const DEFAULT_NETWORK_CONCURRENCY = 4;

interface Waiter {
  readonly signal: AbortSignal | undefined;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  cleanup?: () => void;
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(reason === undefined ? 'The operation was aborted.' : String(reason));
}

/** A process-wide cap for reader/search traffic, including concurrent calls. */
export class NetworkPool {
  readonly limit: number;
  #active = 0;
  #queue: Waiter[] = [];

  constructor(limit = DEFAULT_NETWORK_CONCURRENCY) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw abortReason(signal);
    const release = await this.acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private acquire(signal: AbortSignal | undefined): Promise<() => void> {
    if (this.#active < this.limit) {
      this.#active += 1;
      return Promise.resolve(() => this.release());
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject };
      this.#queue.push(waiter);
      if (!signal) return;
      const onAbort = (): void => {
        const index = this.#queue.indexOf(waiter);
        if (index < 0) return;
        this.#queue.splice(index, 1);
        waiter.cleanup?.();
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      waiter.cleanup = () => signal.removeEventListener('abort', onAbort);
      if (signal.aborted) onAbort();
    });
  }

  private release(): void {
    this.#active -= 1;
    while (this.#queue.length > 0) {
      const waiter = this.#queue.shift()!;
      if (waiter.signal?.aborted) {
        waiter.cleanup?.();
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      this.#active += 1;
      waiter.cleanup?.();
      waiter.resolve(() => this.release());
      return;
    }
  }
}

export const webNetworkPool = new NetworkPool();
