import type { ConversationEvent, Session } from '@plif/core';

export interface TranscriptPersistenceQueueOptions {
  readonly createSession: () => Promise<Session>;
  readonly initialSession?: Session | null;
  readonly onSession: (session: Session) => void;
  readonly onFailure: (error: unknown) => void;
}

/**
 * Serialises transcript writes and exposes the actual I/O boundary to the
 * caller. The reducer can update immediately, but turn cleanup must await this
 * queue before it closes the live stream or lets the session change.
 */
export class TranscriptPersistenceQueue {
  #createSession: () => Promise<Session>;
  #onSession: (session: Session) => void;
  #onFailure: (error: unknown) => void;
  #session: Session | null;
  #sessionPromise: Promise<Session> | null;
  #queue: Promise<void> = Promise.resolve();
  #failed = false;

  constructor(options: TranscriptPersistenceQueueOptions) {
    this.#createSession = options.createSession;
    this.#onSession = options.onSession;
    this.#onFailure = options.onFailure;
    this.#session = options.initialSession ?? null;
    this.#sessionPromise = this.#session ? Promise.resolve(this.#session) : null;
  }

  enqueue(event: ConversationEvent): Promise<void> {
    const write = this.#queue.then(async () => {
      if (this.#failed) return;
      const session = await this.#getSession();
      await session.append(event);
    });

    // Keep the queue usable after a single disk failure. The caller receives a
    // settled promise, the warning is surfaced by onFailure, and later events
    // stay in the in-memory reducer instead of becoming unhandled rejections.
    this.#queue = write.catch((error: unknown) => {
      this.#failed = true;
      this.#onFailure(error);
    });
    return this.#queue;
  }

  /** Resolve only after every append enqueued so far has reached the session. */
  flush(): Promise<void> {
    return this.#queue;
  }

  /** Return the current session only after all queued writes are visible. */
  async session(): Promise<Session | null> {
    await this.#queue;
    return this.#session;
  }

  /**
   * Switch the destination without overtaking writes already queued for the
   * previous session. Session changes normally happen while idle, but keeping
   * this ordering makes the boundary safe under a fast command sequence too.
   */
  setSession(session: Session): void {
    const next = this.#queue.then(() => {
      this.#session = session;
      this.#sessionPromise = Promise.resolve(session);
      this.#failed = false;
    });
    this.#queue = next.catch((error: unknown) => {
      this.#failed = true;
      this.#onFailure(error);
    });
  }

  async #getSession(): Promise<Session> {
    if (!this.#sessionPromise) {
      this.#sessionPromise = this.#createSession();
    }
    const session = await this.#sessionPromise;
    if (this.#session !== session) {
      this.#session = session;
      this.#onSession(session);
    }
    return session;
  }
}
