/**
 * The agent asking the human a question.
 *
 * Distinct from `ApprovalBroker`, and deliberately so. An approval is a gate:
 * the agent already knows what it wants to do and needs permission. A question
 * is the opposite — the agent has hit something it cannot decide alone and
 * wants *information*. Collapsing the two would force every question into a
 * yes/no shape, and "should I use Postgres or SQLite here?" has no yes.
 *
 * Two behaviours carried over from the approval broker, for the same reasons:
 *
 * - **Timeouts do not invent an answer.** An unanswered question resolves to
 *   `null`, and the loop is expected to say so and pick a defensible default
 *   rather than pretend the human agreed to something.
 * - **The question is never silently dropped.** Even on timeout the transcript
 *   records that it was asked, so a developer reading back knows the agent
 *   paused for them and got nothing.
 */

import { randomUUID } from 'node:crypto';

import type { EventBus, QuestionOption } from '../events/bus.js';

export type QuestionChoice = string | QuestionOption;

export interface Question {
  /** The question itself, in the agent's words. */
  readonly text: string;
  /**
   * Suggested answers. The human may still type something else — these are a
   * shortcut, not a constraint, because an agent that could enumerate every
   * valid answer would not have needed to ask.
   */
  readonly options?: readonly QuestionChoice[];
  /** Why the agent is stuck. Shown under the question so the human can judge. */
  readonly context?: string;
  /**
   * A credential, not an answer.
   *
   * The value reaches the caller by resolving this promise and by no other
   * route: it is left out of `question.answered`, so nothing subscribed to the
   * bus — the timeline, the transcript, the audit log — ever sees it. The
   * interface masks it while it is typed.
   */
  readonly secret?: boolean;
}

interface Pending {
  readonly question: Question;
  readonly resolve: (answer: string | null) => void;
  readonly timer: NodeJS.Timeout;
}

export class QuestionBroker {
  #bus: EventBus;
  #pending = new Map<string, Pending>();
  #timeoutMs: number;

  constructor(bus: EventBus, timeoutMs = 600_000) {
    this.#bus = bus;
    this.#timeoutMs = timeoutMs;
  }

  /** Ask, and wait. Resolves to `null` if nobody answers in time. */
  ask(question: Question): Promise<string | null> {
    const id = randomUUID();
    const options = question.options?.map((option) =>
      typeof option === 'string' ? { value: option, label: option } : option,
    );

    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#bus.emit('question.answered', { id, answer: null });
        resolve(null);
      }, this.#timeoutMs);
      // Never hold the process open waiting for an answer nobody will give.
      timer.unref?.();

      this.#pending.set(id, { question, resolve, timer });
      this.#bus.emit('question.asked', {
        id,
        text: question.text,
        options,
        context: question.context,
        ...(question.secret ? { secret: true } : {}),
      });
    });
  }

  answer(id: string, text: string): void {
    const pending = this.#pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.#pending.delete(id);
    // A secret is reported as answered without being reported. `redacted`
    // separates that from the timeout, which also carries no answer.
    this.#bus.emit(
      'question.answered',
      pending.question.secret ? { id, answer: null, redacted: true } : { id, answer: text },
    );
    pending.resolve(text);
  }

  /** Give up on everything outstanding. Used on cancel and on shutdown. */
  abandonAll(): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      this.#bus.emit('question.answered', { id, answer: null });
      pending.resolve(null);
    }
    this.#pending.clear();
  }

  outstanding(): { id: string; question: Question }[] {
    return [...this.#pending.entries()].map(([id, pending]) => ({
      id,
      question: pending.question,
    }));
  }
}
