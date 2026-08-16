/**
 * Thinking that arrives in the wrong channel.
 *
 * There are two ways a model shows its reasoning, and only one of them is
 * structured. Hosted reasoning models put it on a side field —
 * `reasoning_content` on DeepSeek, `reasoning` on most gateways — and the
 * provider reads it straight off the delta. Everything else, which in practice
 * means every distilled R1, QwQ and Qwen-thinking checkpoint served by Ollama,
 * llama.cpp, LM Studio or vLLM, writes `<think>…</think>` into `content` and
 * expects the client to work it out.
 *
 * Left alone, that second kind dumps a page of interior monologue into the
 * answer, and — worse — the monologue is then replayed as assistant content on
 * the next request, so the model reads its own thinking as though it had said
 * it out loud. Routing it here fixes both: the interface gets a collapsible
 * thinking block, and `content` carries only what the model actually meant to
 * say.
 *
 * Two properties make this safe on a streamed feed:
 *
 * - **Tags split across chunks are handled.** `<thi` can arrive at the end of
 *   one delta and `nk>` at the start of the next, so any suffix that could
 *   still become a tag is held back rather than emitted as text.
 * - **A tag is only honoured where a real one appears.** Thinking models open
 *   with the tag before saying anything else, so an opening tag is accepted
 *   only while nothing but whitespace has been emitted, and never again after
 *   the first block closes. That is what stops a `<think>` inside a fenced code
 *   block in an ordinary answer from swallowing the rest of the response.
 */

export interface ReasoningSplit {
  readonly kind: 'text' | 'reasoning';
  readonly delta: string;
}

const NAMES = ['think', 'thinking', 'reason', 'reasoning', 'thought'];
const OPENERS = NAMES.map((name) => `<${name}>`);
const CLOSERS = NAMES.map((name) => `</${name}>`);
const LONGEST = Math.max(...[...OPENERS, ...CLOSERS].map((tag) => tag.length));

export class ReasoningSplitter {
  /** Text held back because it might be the front of a tag. */
  #held = '';
  #inside = false;
  #saw = false;
  /** Cleared once real text lands, or once the first block closes. */
  #openable = true;

  /** True once a `<think>` block has been seen on this stream. */
  get sawReasoning(): boolean {
    return this.#saw;
  }

  push(delta: string): ReasoningSplit[] {
    const out: ReasoningSplit[] = [];
    this.#held += delta;

    for (;;) {
      const hit = firstTag(this.#held, this.#inside ? CLOSERS : OPENERS);
      if (!hit) break;
      // An opening tag where one cannot legitimately appear is just text. Emit
      // it and stop scanning, or the same match is found again forever.
      if (!this.#inside && !this.#openable) break;

      const before = this.#held.slice(0, hit.index);
      if (before) out.push(this.#emit(before));
      this.#held = this.#held.slice(hit.index + hit.length);

      if (this.#inside) {
        this.#inside = false;
        this.#openable = false;
      } else {
        this.#inside = true;
        this.#saw = true;
      }
    }

    // Whatever cannot yet be ruled out as the start of a tag waits for the next
    // chunk. Everything before it is safe to hand on.
    const hold = partialTagLength(this.#held, this.#inside ? CLOSERS : OPENERS);
    const ready = this.#held.slice(0, this.#held.length - hold);
    this.#held = this.#held.slice(this.#held.length - hold);
    if (ready) out.push(this.#emit(ready));

    return out;
  }

  /**
   * Release whatever is still held, at end of stream.
   *
   * A model that opens `<think>` and never closes it — truncated by a length
   * limit, usually — has its remainder treated as thinking rather than silently
   * dropped, because that is what it is.
   */
  flush(): ReasoningSplit[] {
    if (!this.#held) return [];
    const out = [this.#emit(this.#held)];
    this.#held = '';
    return out;
  }

  #emit(delta: string): ReasoningSplit {
    if (!this.#inside && delta.trim()) this.#openable = false;
    return { kind: this.#inside ? 'reasoning' : 'text', delta };
  }
}

function firstTag(
  haystack: string,
  tags: readonly string[],
): { index: number; length: number } | null {
  const lower = haystack.toLowerCase();
  let best: { index: number; length: number } | null = null;
  for (const tag of tags) {
    const index = lower.indexOf(tag);
    if (index < 0) continue;
    // Earliest wins, and on a tie the longer tag does — `<thinking>` and
    // `<think>` both match at the same offset, and consuming six characters
    // would leave a stray "ing>" in the output.
    if (!best || index < best.index || (index === best.index && tag.length > best.length)) {
      best = { index, length: tag.length };
    }
  }
  return best;
}

/** Length of the longest suffix that is still a possible prefix of a tag. */
function partialTagLength(haystack: string, tags: readonly string[]): number {
  const lower = haystack.toLowerCase();
  const start = Math.max(0, lower.length - (LONGEST - 1));
  for (let index = start; index < lower.length; index += 1) {
    if (lower[index] !== '<') continue;
    const suffix = lower.slice(index);
    if (tags.some((tag) => tag.startsWith(suffix))) return lower.length - index;
  }
  return 0;
}

/**
 * Pull thinking off a streamed delta, whatever the host calls it.
 *
 * Every field seen in the wild, in the order they were met. `reasoning` can be
 * an object on gateways that mirror the Responses API, so a bare string check
 * is not enough — OpenRouter sends `{ text }` under some upstreams and a plain
 * string under others, on the same endpoint.
 */
export type ReasoningSemantics = 'delta' | 'snapshot' | 'unknown';

export type ReasoningSource =
  | 'reasoning_content'
  | 'reasoning'
  | 'thinking'
  | 'thought'
  | 'reasoning_details';

export interface ReasoningObservation {
  readonly text: string;
  readonly source: ReasoningSource;
  readonly semantics: ReasoningSemantics;
}

/**
 * Preserve the wire field alongside its text so normalization can keep one raw
 * cursor per source. String side channels vary by host; structured detail
 * arrays are cumulative snapshots in the OpenAI-compatible shape.
 */
export function reasoningObservationFromDelta(delta: unknown): ReasoningObservation | undefined {
  if (!delta || typeof delta !== 'object') return undefined;
  const fields = delta as Record<string, unknown>;

  const stringSources = ['reasoning_content', 'reasoning', 'thinking', 'thought'] as const;
  for (const key of stringSources) {
    const value = fields[key];
    if (typeof value === 'string' && value) {
      return { text: value, source: key, semantics: 'unknown' };
    }
    if (value && typeof value === 'object') {
      const text = (value as { text?: unknown; content?: unknown }).text ??
        (value as { content?: unknown }).content;
      if (typeof text === 'string' && text) {
        return { text, source: key, semantics: 'unknown' };
      }
    }
  }

  // OpenRouter's structured form: an array of blocks, each with its own text.
  const details = fields['reasoning_details'];
  if (Array.isArray(details)) {
    const joined = details
      .map((block) =>
        block && typeof block === 'object'
          ? String((block as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
    if (joined) {
      return { text: joined, source: 'reasoning_details', semantics: 'snapshot' };
    }
  }

  return undefined;
}

/** Backwards-compatible text-only extraction for existing consumers. */
export function reasoningFromDelta(delta: unknown): string | undefined {
  return reasoningObservationFromDelta(delta)?.text;
}

/**
 * OpenAI-compatible hosts disagree on whether reasoning fields are deltas or
 * the complete snapshot so far. Convert both shapes into actual increments.
 */
export class ReasoningDeltaNormalizer {
  #value = '';
  #lastRawBySource = new Map<ReasoningSource, string>();

  get value(): string {
    return this.#value;
  }

  push(input: string | ReasoningObservation): string {
    const observation: ReasoningObservation = typeof input === 'string'
      ? { text: input, source: 'reasoning', semantics: 'unknown' }
      : input;
    const incoming = observation.text;
    if (!incoming) return '';

    const previousRaw = this.#lastRawBySource.get(observation.source) ?? '';
    this.#lastRawBySource.set(observation.source, incoming);

    let emitted = incoming;
    if (observation.semantics === 'snapshot') {
      if (incoming === previousRaw) emitted = '';
      else if (previousRaw && incoming.startsWith(previousRaw)) {
        emitted = incoming.slice(previousRaw.length);
      }
    } else if (
      observation.semantics === 'unknown' &&
      previousRaw &&
      (incoming === previousRaw || (
        incoming.length > previousRaw.length &&
        incoming.startsWith(previousRaw)
      ))
    ) {
      // An unchanged side-channel value is a replayed snapshot/no-op, not new
      // reasoning. Treating it as a delta turns one token such as "Asp" into
      // an unbounded `AspAspAsp...` stream when a gateway repeats a snapshot
      // while waiting for the next token. A strict extension is still reduced
      // to its new suffix for cumulative snapshots.
      emitted = incoming === previousRaw ? '' : incoming.slice(previousRaw.length);
    }

    this.#value += emitted;
    return emitted;
  }
}
