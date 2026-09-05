/**
 * The OpenAI-compatible provider.
 *
 * A translation layer over the official SDK. The SDK owns the wire protocol
 * and connection pooling; this provider owns the visible retry budget because
 * streamed output must be reset atomically when an attempt fails.
 *
 * What this file *does* own is the two things the SDK deliberately leaves to
 * the caller:
 *
 *   1. **Assembling streamed tool calls.** They arrive as fragments — a name in
 *      one chunk, arguments split across a dozen more — and a half-parsed JSON
 *      argument is useless to the loop. They are buffered here and emitted
 *      whole.
 *   2. **Turning transport failures into something actionable.** "401" is not a
 *      useful thing to show a developer at 2am; "your key was rejected by
 *      api.openai.com — check OPENAI_API_KEY" is.
 */

import type OpenAI from 'openai';
import type { ClientOptions } from 'openai';

import { dispatcherFor } from './proxy.js';
import {
  APIUserAbortError,
  isApiConnectionError,
  isApiConnectionTimeoutError,
  isApiError,
  isUserAbortError,
} from './sdk-errors.js';

import { PlifError } from '../errors.js';
import type { ModelConfig } from './config.js';
import { isLocal, keyOptional } from './config.js';
import type { CachedEffort, EffortCapabilityCache } from './capabilities.js';
import { redactedProviderId, streamTiming } from './stream-timing.js';
import { modelListResult, normalizeProviderModel } from './metadata.js';
import {
  freshUsageSnapshot,
  providerPolicyUsage,
  usageFromRateLimitHeaders,
  type UsageInfo,
} from './usage.js';
import { normalizeOpenAIUsage } from './token-usage.js';
import { ContentDeltaNormalizer } from './content.js';
import type { StreamTiming } from './stream-timing.js';
import type { EventBus } from '../events/bus.js';
import {
  ReasoningDeltaNormalizer,
  ReasoningSplitter,
  reasoningObservationFromDelta,
} from './reasoning.js';
import type {
  CompletionEvent,
  CompletionRequest,
  FinishReason,
  Message,
  ModelListResult,
  ModelInfo,
  ModelProvider,
  ProviderModel,
  ToolCall,
  Usage,
} from './provider.js';
import { NO_USAGE, safeToolCallArguments } from './provider.js';

/** One owner, one visible budget. The SDK's hidden retries are disabled below. */
// A stalled gateway used to consume 120 seconds per attempt, six times. That
// looked indistinguishable from a frozen terminal and made Ctrl+C the only
// practical escape hatch. Keep recovery for brief upstream faults, but bound
// a silent request to a short, visible retry window.
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_WAIT_MS = 30_000;
const RETRY_MAX_SERVER_WAIT_MS = 60_000;
const RETRY_DEADLINE_MS = 90_000;
const FIRST_RESPONSE_TIMEOUT_MS = 45_000;

/**
 * Wire values accepted by current OpenAI reasoning endpoints. The installed
 * SDK can lag the endpoint contract, so Plif keeps the superset here and
 * narrows only at the call boundary.
 */
const PLIF_EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low'] as const;
type WireEffort = (typeof PLIF_EFFORTS)[number] | 'low' | 'medium';

export interface OpenAIProviderOptions {
  /** Optional persisted effort negotiation cache. */
  readonly capabilityCache?: EffortCapabilityCache;
  /** Redacted timing sink, normally `engine.bus.emit('stream.timing', ...)`. */
  readonly onTiming?: (timing: StreamTiming) => void;
  /** Convenience sink that keeps callers from writing an unsafe adapter. */
  readonly bus?: Pick<EventBus, 'emit'>;
}

/**
 * Failures that another attempt could plausibly clear.
 *
 * Deliberately not `MODEL_AUTH` or `MODEL_NOT_FOUND`: a rejected key and a
 * misspelled model id are exactly as wrong on the tenth attempt, and spending
 * four minutes to repeat that is worse than saying it immediately.
 */
const RETRYABLE: ReadonlySet<string> = new Set([
  'MODEL_UNAVAILABLE',
  'MODEL_TIMEOUT',
  'MODEL_RATE_LIMIT',
]);

/** A connection can close cleanly at the transport layer while the response
 * itself is still incomplete. Treat that EOF as a retryable stream failure. */
class StreamInterruptedError extends Error {
  constructor(
    message = 'stream ended before the endpoint sent a finish reason',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StreamInterruptedError';
  }
}

class StreamIdleTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`stream produced no data for ${timeoutMs}ms`);
    this.name = 'StreamIdleTimeoutError';
  }
}

/** A cancellable wait. Rejects if the signal fires first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelay(attempt: number, retryAfterMs: number | undefined): number {
  if (retryAfterMs !== undefined) {
    return Math.max(0, Math.min(retryAfterMs, RETRY_MAX_SERVER_WAIT_MS));
  }
  const exponential = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_WAIT_MS);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(exponential * jitter);
}

async function nextChunk<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
  controller: AbortController,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new APIUserAbortError());
      return;
    }

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      controller.abort();
      reject(new APIUserAbortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      controller.abort();
      reject(new StreamIdleTimeoutError(timeoutMs));
    }, timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });
    void iterator.next().then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Apply the same cancellable deadline while the HTTP response is opening. */
async function waitForStream<T>(
  operation: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
  signal?: AbortSignal,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      controller.abort();
      reject(new APIUserAbortError());
      return;
    }

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      controller.abort();
      reject(new APIUserAbortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      controller.abort();
      reject(new StreamIdleTimeoutError(timeoutMs));
    }, Math.max(0, timeoutMs));

    signal?.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export class OpenAIProvider implements ModelProvider {
  readonly info: ModelInfo;
  /**
   * Built on first use. Importing the SDK is ~110ms of module loading, and a
   * session that never reaches this provider should never pay it.
   */
  #client: OpenAI | undefined;
  #clientPromise: Promise<OpenAI> | undefined;
  #clientOptions: ClientOptions | undefined;
  #config: ModelConfig;
  #capabilityCache: EffortCapabilityCache | undefined;
  #onTiming: ((timing: StreamTiming) => void) | undefined;
  #capabilityLoad: Promise<void> | undefined;
  #usageHeaders: Headers | undefined;
  #usageSnapshot: UsageInfo | undefined;
  /** Highest Plif candidate accepted by this provider instance. */
  #plifEffortIndex = 0;
  /**
   * This endpoint rejects `reasoning_effort` at every level.
   *
   * Set when the ladder runs out, and cached as `none` so the next session
   * starts here instead of rediscovering it from the top.
   */
  #effortUnsupported = false;

  constructor(config: ModelConfig, options: OpenAIProviderOptions = {}) {
    this.#config = config;
    this.#capabilityCache = options.capabilityCache;
    this.#onTiming = options.onTiming ?? (options.bus
      ? (timing) => options.bus!.emit('stream.timing', timing)
      : undefined);
    const anonymous = !config.apiKey && keyOptional(config.baseURL, config.model, config.providerId);
    type SdkFetch = NonNullable<ClientOptions['fetch']>;
    const captureFetch = (async (...args: Parameters<SdkFetch>): Promise<Awaited<ReturnType<SdkFetch>>> => {
      const [input, init] = args;
      // Preserve headers carried by a Request object as well as SDK init
      // headers. Replacing them with only init headers can silently drop
      // provider-specific authentication when an SDK changes its fetch call
      // shape.
      const headers = new globalThis.Headers(
        input instanceof globalThis.Request ? input.headers : undefined,
      );
      new globalThis.Headers(init?.headers as any).forEach((value, key) => headers.set(key, value));
      if (anonymous) headers.delete('authorization');
      // `dispatcher` is Node's own extension to RequestInit, absent from the
      // DOM typings this signature is written against, and inert when nothing
      // configured a proxy.
      const dispatcher = await dispatcherFor(config.baseURL);
      const response = await globalThis.fetch(
        input as any,
        { ...init, headers, ...(dispatcher ? { dispatcher } : {}) } as any,
      );
      this.#usageHeaders = new globalThis.Headers(response.headers);
      this.#usageSnapshot = undefined;
      return response as unknown as Awaited<ReturnType<SdkFetch>>;
    }) as SdkFetch;
    this.#clientOptions = {
      // The SDK requires a non-empty constructor key, but OpenCode's free tier
      // is genuinely anonymous. Use an internal sentinel only to satisfy the
      // SDK, then strip Authorization in the fetch wrapper before the request
      // leaves the process. Paid providers still use their real credential.
      apiKey: config.apiKey || (anonymous ? 'plif-anonymous' : ''),
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      fetch: captureFetch,
      // Gateway headers ride as SDK defaults rather than being written in the
      // fetch wrapper, so a per-request header the SDK sets still wins — these
      // are defaults for the endpoint, not overrides of the conversation.
      ...(config.headers ? { defaultHeaders: { ...config.headers } } : {}),
      // Retry belongs to this provider so attempts, waits, cancellation and
      // partial-output resets share one budget and remain visible to the UI.
      maxRetries: 0,
    };
    this.info = {
      id: config.model,
      ...(config.providerId ? { providerId: config.providerId } : {}),
      endpoint: config.baseURL,
      contextWindow: config.contextWindow,
      ...(config.maxTokens === undefined ? {} : { maxOutputTokens: config.maxTokens }),
      capabilities: {
        usageSemantics: 'openai-compatible',
        cacheSupport: 'reported',
        cacheAccounting: 'separate-if-reported',
        reasoningAccounting: 'reported',
      },
    };
  }

  /** The SDK client, imported and constructed on first use. */
  async #openai(): Promise<OpenAI> {
    if (this.#client) return this.#client;
    this.#clientPromise ??= import('openai').then(({ default: OpenAIClient }) => {
      this.#client = new OpenAIClient(this.#clientOptions);
      this.#clientOptions = undefined;
      return this.#client;
    });
    return await this.#clientPromise;
  }

  /**
   * Stream, and keep trying when the endpoint is the thing that broke.
   *
   * The failure that actually costs a session is the one that arrives mid-flight
   * with a 500. OpenCode Zen fans out across upstreams, so a bad minute on one
   * of them surfaces as `Internal server error: function_call arguments JSON
   * parse error` and kills a turn that was thirty seconds in. That is worth
   * waiting out rather than handing back to the developer.
   *
   * One capped exponential schedule with jitter covers connection, HTTP and
   * stream failures. Retry-After wins when the endpoint supplies it, bounded by
   * the same global deadline so a bad host cannot hold the turn indefinitely.
   *
   * Only failures that could plausibly clear on their own are retried. A
   * rejected key or an unknown model id will be just as rejected in forty-five
   * seconds, and burning four minutes to say so is worse than saying it now.
   */
  async *stream(request: CompletionRequest): AsyncGenerator<CompletionEvent> {
    await this.#loadCachedEffort();
    let delivered = false;
    const startedAt = Date.now();

    for (let attempt = 1; ; attempt += 1) {
      try {
        for await (const event of this.#attempt(request)) {
          if (event.kind !== 'done') delivered = true;
          yield event;
        }
        return;
      } catch (error) {
        // Capability negotiation is separate from transport retries. A 400
        // that rejects only the requested reasoning level should immediately
        // fall back to the next supported level without burning the retry
        // budget intended for a failing endpoint.
        if (this.#advancePlifEffort(error)) {
          if (delivered) {
            yield { kind: 'reset' };
            delivered = false;
          }
          // Capability probing is not an endpoint retry. Keep the visible
          // transport-attempt budget unchanged while moving down the ladder.
          attempt -= 1;
          continue;
        }
        const plif = this.#translate(error);
        const retryAfterMs = retryAfterOf(error);
        const waitMs = retryDelay(attempt, retryAfterMs);
        const deadlineReached = Date.now() - startedAt + waitMs >= RETRY_DEADLINE_MS;
        const last = attempt >= RETRY_ATTEMPTS || deadlineReached;

        if (last || !RETRYABLE.has(plif.code) || request.signal?.aborted) {
          if (attempt === 1) throw plif;
          // Say how hard it tried. "could not reach the endpoint" after four
          // minutes of silent retrying reads like it gave up immediately.
          throw new PlifError(plif.code, `${plif.message} — gave up after ${attempt} attempts`, {
            cause: plif,
            detail: { attempts: attempt, endpoint: this.#config.baseURL },
            hint: 'The endpoint has been failing for several minutes. Try another model with /model, or come back to it.',
          });
        }

        // Discard the half-delivered turn before announcing the retry, so
        // nothing is ever showing two attempts at once.
        if (delivered) {
          yield { kind: 'reset' };
          delivered = false;
        }
        yield {
          kind: 'retry',
          attempt,
          of: RETRY_ATTEMPTS,
          waitMs,
          reason: plif.message,
        };

        try {
          await this.waitBeforeRetry(waitMs, request.signal);
        } catch {
          // Cancelled while waiting. Not a failure to report — the developer
          // asked for it to stop.
          yield { kind: 'done', reason: 'cancelled', usage: NO_USAGE };
          return;
        }
      }
    }
  }

  /**
   * The single call that touches the network.
   *
   * Split out so the retry schedule can be tested without one. Everything
   * above it — the backoff, the reset, the decision about which failures are
   * worth another attempt — is logic that only shows itself when the endpoint
   * misbehaves, which is exactly the condition that cannot be arranged on
   * demand against a real host.
   */
  protected async createStream(
    body: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    options: { signal?: AbortSignal },
  ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>> {
    const client = await this.#openai();
    return client.chat.completions.create(body, options) as unknown as Promise<
      AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
    >;
  }

  protected waitBeforeRetry(ms: number, signal?: AbortSignal): Promise<void> {
    return sleep(ms, signal);
  }

  protected firstChunkTimeoutMs(): number {
    // Long answers may legitimately stream for longer than this. The cap is
    // only for the period with no first event at all — the state that users
    // experience as a frozen "Composing" line.
    return Math.min(this.#config.timeoutMs, FIRST_RESPONSE_TIMEOUT_MS);
  }

  protected interChunkTimeoutMs(): number {
    return this.#config.timeoutMs;
  }

  async *#attempt(request: CompletionRequest): AsyncGenerator<CompletionEvent> {
    const startedAt = Date.now();
    let firstChunk = false;
    let firstDelta = false;
    const emitTiming = (
      phase: StreamTiming['phase'],
      extra: { readonly bytes?: number; readonly deltaKind?: StreamTiming['deltaKind'] } = {},
    ): void => {
      if (!this.#onTiming) return;
      this.#onTiming(streamTiming({
        phase,
        elapsedMs: Date.now() - startedAt,
        provider: redactedProviderId(this.#config.baseURL),
        model: this.#config.model,
        ...extra,
      }));
    };
    // Nothing was sent when the field is known to be unsupported, so there is
    // no accepted level to remember — caching one here would record a rung the
    // endpoint never saw, and the next session would send it and fail.
    const acceptedEffort =
      this.#config.effort === 'plif' && !this.#effortUnsupported ? this.#wireEffort() : undefined;
    const pending = new ToolCallBuffer();
    // Two channels arrive as one on models that write `<think>` into content.
    // Splitting here rather than in the loop means every consumer — the TUI,
    // the print path, a test — sees the same two kinds of event whichever way
    // the host happens to frame it.
    const splitter = new ReasoningSplitter();
    const contentDeltas = new ContentDeltaNormalizer();
    const reasoningDeltas = new ReasoningDeltaNormalizer();
    let reason: FinishReason = 'stop';
    let usage: Usage = NO_USAGE;
    let finished = false;
    const attemptAbort = new AbortController();
    const firstChunkTimeoutMs = this.firstChunkTimeoutMs();
    const firstChunkDeadline = Date.now() + firstChunkTimeoutMs;
    let iterator: AsyncIterator<OpenAI.Chat.ChatCompletionChunk> | undefined;
    const onRequestAbort = (): void => attemptAbort.abort();
    request.signal?.addEventListener('abort', onRequestAbort, { once: true });
    if (request.signal?.aborted) attemptAbort.abort();

    try {
      emitTiming('request');
      const response = await waitForStream(
        this.createStream({
          model: this.#config.model,
          messages: request.messages.map(toWire),
          temperature: request.temperature ?? this.#config.temperature,
          stream: true,
          // Ask for usage on the final chunk. Endpoints that do not implement
          // this simply omit it, which is why the default is a zeroed Usage
          // rather than an error.
          stream_options: { include_usage: true },
          ...(request.maxTokens ?? this.#config.maxTokens
            ? { max_tokens: request.maxTokens ?? this.#config.maxTokens }
            : {}),
          // A model known to reject the field is sent no field, rather than a
          // level it will refuse. This is the whole payoff of caching `none`.
          ...(this.#config.effort && !this.#effortUnsupported
            ? {
                reasoning_effort: this.#wireEffort() as unknown as OpenAI.Chat.ChatCompletionReasoningEffort,
              }
            : {}),
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function' as const,
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
              }
            : {}),
        }, { signal: attemptAbort.signal }),
        firstChunkTimeoutMs,
        attemptAbort,
        request.signal,
      );

      iterator = response[Symbol.asyncIterator]();
      let firstRead = true;
      while (true) {
        const timeoutMs = firstRead
          ? Math.max(0, firstChunkDeadline - Date.now())
          : this.interChunkTimeoutMs();
        let next: IteratorResult<OpenAI.Chat.ChatCompletionChunk>;
        try {
          next = await nextChunk(iterator, timeoutMs, attemptAbort, request.signal);
        } catch (error) {
          if (
            isAbort(error) ||
            isApiError(error) ||
            error instanceof StreamIdleTimeoutError ||
            error instanceof StreamInterruptedError
          ) {
            throw error;
          }
          throw new StreamInterruptedError(
            'stream parser failed after the response opened',
            { cause: error },
          );
        }
        firstRead = false;
        if (!firstChunk) {
          firstChunk = true;
          emitTiming('first-chunk');
        }
        if (next.done) break;
        const chunk = next.value;
        if (chunk.usage) {
          usage = normalizeOpenAIUsage(chunk.usage) ?? usage;
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const rawChoice = choice as typeof choice & {
          readonly message?: { readonly content?: unknown };
        };
        const text = typeof choice.delta?.content === 'string' ? choice.delta.content : '';
        const visibleText = text
          ? contentDeltas.push({
              text,
              semantics: this.#config.streamSemantics ?? 'delta',
            })
          : '';
        const finalText = typeof rawChoice.message?.content === 'string'
          ? contentDeltas.push({ text: rawChoice.message.content, semantics: 'snapshot' })
          : '';
        for (const content of [visibleText, finalText]) {
          if (!content) continue;
          for (const part of splitter.push(content)) {
            if (!firstDelta) {
              firstDelta = true;
              emitTiming('first-delta', {
                bytes: Buffer.byteLength(part.delta, 'utf8'),
                deltaKind: part.kind,
              });
            }
            yield { kind: part.kind, delta: part.delta };
          }
        }

        // Reasoning models put their thinking on a side field, and no two hosts
        // agree on which one. None of them are in the SDK types.
        const thinking = reasoningObservationFromDelta(choice.delta);
        if (thinking) {
          const delta = reasoningDeltas.push(thinking);
          if (delta) {
            if (!firstDelta) {
              firstDelta = true;
              emitTiming('first-delta', {
                bytes: Buffer.byteLength(delta, 'utf8'),
                deltaKind: 'reasoning',
              });
            }
            yield { kind: 'reasoning', delta };
          }
        }

        for (const fragment of choice.delta?.tool_calls ?? []) {
          pending.absorb(fragment);
        }

        if (choice.finish_reason) {
          reason = mapFinishReason(choice.finish_reason);
          finished = true;
        }
      }

      // Some gateways close an SSE response without sending an error or the
      // final finish_reason. The old code treated that graceful EOF as a
      // successful answer, which is exactly how responses were silently cut
      // off. Force it through the existing stream retry path instead.
      if (!finished) throw new StreamInterruptedError();

      // Anything the splitter was still holding back — a trailing `<` that
      // never became a tag, or an unclosed thinking block.
      for (const part of splitter.flush()) {
        yield { kind: part.kind, delta: part.delta };
      }

      // Tool calls are emitted only once the stream is complete, because their
      // arguments are not valid JSON until the last fragment has arrived.
      const calls = pending.drain();
      for (const call of calls) {
        if (!firstDelta) {
          firstDelta = true;
          emitTiming('first-delta', { deltaKind: 'tool' });
        }
        yield { kind: 'tool', call };
      }

      await this.#rememberEffort(acceptedEffort);
      emitTiming('completion', { deltaKind: 'done' });
      yield { kind: 'done', reason, usage };
    } catch (error) {
      if (isAbort(error)) {
        yield { kind: 'done', reason: 'cancelled', usage };
        return;
      }
      // Raw, not translated. The retry loop above translates once and needs the
      // code to decide whether another attempt could possibly help.
      throw error;
    } finally {
      attemptAbort.abort();
      request.signal?.removeEventListener('abort', onRequestAbort);
      if (iterator?.return) {
        try {
          await Promise.resolve(iterator.return()).catch(() => undefined);
        } catch {
          // The request is already terminal; iterator cleanup cannot change it.
        }
      }
    }
  }

  async #loadCachedEffort(): Promise<void> {
    if (this.#config.effort !== 'plif') return;

    /**
     * A model already declared as non-reasoning needs no negotiation.
     *
     * Walking the ladder to prove it costs five refused requests on the first
     * turn of every session with a cold cache. Only the negative is trusted:
     * `reasoning: true` says the model thinks, not which level names its
     * endpoint accepts, so that is still negotiated.
     */
    if (this.#config.reasoning === false) {
      this.#effortUnsupported = true;
      return;
    }

    if (!this.#capabilityCache) return;
    if (!this.#capabilityLoad) {
      this.#capabilityLoad = (async () => {
        try {
          const cached = await this.#capabilityCache!.get(this.#config.baseURL, this.#config.model);
          if (!cached) return;
          if (cached === 'none') {
            this.#effortUnsupported = true;
            return;
          }
          const index = PLIF_EFFORTS.indexOf(cached as (typeof PLIF_EFFORTS)[number]);
          if (index >= 0) this.#plifEffortIndex = index;
        } catch {
          // Negotiation remains the safe fallback when the optional cache is
          // unreadable or unavailable.
        }
      })();
    }
    await this.#capabilityLoad;
  }

  async #rememberEffort(effort: WireEffort | undefined): Promise<void> {
    if (!effort || this.#config.effort !== 'plif' || !this.#capabilityCache) return;
    try {
      await this.#capabilityCache.set(
        this.#config.baseURL,
        this.#config.model,
        effort as CachedEffort,
      );
    } catch {
      // A cache write must never turn a valid model response into a failed turn.
    }
  }

  #wireEffort(): WireEffort {
    if (this.#config.effort === 'plif') {
      return PLIF_EFFORTS[this.#plifEffortIndex] ?? 'high';
    }
    if (this.#config.effort === 'ultra' || this.#config.effort === 'max') return 'max';
    if (this.#config.effort === 'ultracode') return 'xhigh';
    // Preserve the existing compatibility behavior for explicit xhigh. Plif
    // is the mode that negotiates beyond the SDK's currently typed values.
    if (this.#config.effort === 'xhigh') return 'high';
    return this.#config.effort ?? 'high';
  }

  /**
   * Step down the ladder, and know when to stop asking.
   *
   * Two things changed here. The bottom rung used to give up: at `low`, a
   * rejection fell through to the transport path and the turn failed, so a
   * model that does not speak `reasoning_effort` at all was simply unusable in
   * Plif mode — the one mode meant to adapt to whatever the model supports.
   * Now the ladder ends by dropping the field entirely and retrying, which is
   * the answer that was always available.
   *
   * And the outcome is cached either way. Rediscovering "this model takes no
   * reasoning level" costs five failed round trips, every session, forever;
   * `none` costs one lookup.
   */
  #advancePlifEffort(error: unknown): boolean {
    if (this.#config.effort !== 'plif' || this.#effortUnsupported) return false;
    const current = PLIF_EFFORTS[this.#plifEffortIndex];
    if (!current) return false;
    if (!isUnsupportedReasoningEffort(error, current)) return false;

    if (this.#plifEffortIndex >= PLIF_EFFORTS.length - 1) {
      this.#effortUnsupported = true;
      void this.#rememberUnsupportedEffort();
      return true;
    }

    // The cached level was the one just refused, so it is wrong and worth
    // clearing. Intermediate rungs are cleared for the same reason.
    void Promise.resolve(
      this.#capabilityCache?.invalidate?.(this.#config.baseURL, this.#config.model),
    ).catch(() => undefined);
    this.#plifEffortIndex += 1;
    return true;
  }

  async #rememberUnsupportedEffort(): Promise<void> {
    if (!this.#capabilityCache) return;
    try {
      await this.#capabilityCache.set(this.#config.baseURL, this.#config.model, 'none');
    } catch {
      // Same rule as every other cache write: never turn an optimisation into
      // a failed turn.
    }
  }

  async probe(): Promise<{ ok: boolean; detail: string }> {
    try {
      // One token is enough to prove the endpoint, the model id and the key are
      // all good — and costs essentially nothing on a metered API.
      await (await this.#openai()).chat.completions.create({
        model: this.#config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
      return { ok: true, detail: `${this.#config.model} responded` };
    } catch (error) {
      const translated = this.#translate(error);
      return { ok: false, detail: translated.message };
    }
  }

  async list(): Promise<string[]> {
    const result = await this.listModels();
    return result.models.map((model) => model.id).sort();
  }

  withEffort(effort: import('./config.js').Effort): ModelProvider {
    return new OpenAIProvider({ ...this.#config, effort }, {
      ...(this.#capabilityCache ? { capabilityCache: this.#capabilityCache } : {}),
      ...(this.#onTiming ? { onTiming: this.#onTiming } : {}),
    });
  }

  async listModels(): Promise<ModelListResult> {
    try {
      // PagePromise is async-iterable. Consume the provider's complete result
      // through that contract instead of coupling discovery to one SDK page
      // shape; this also keeps adapters that implement paging compatible.
      const entries: ProviderModel[] = [];
      for await (const model of (await this.#openai()).models.list()) {
        const normalized = normalizeProviderModel(
          model as unknown as Record<string, unknown>,
          this.#config,
        );
        if (normalized) entries.push(normalized);
      }
      return modelListResult(this.#config, entries);
    } catch (error) {
      // Plenty of compatible servers do not implement /models. That is not an
      // error worth surfacing — it just means we cannot offer a picker.
      const status = (error as { readonly status?: unknown }).status;
      const failure = status === 429
        ? 'rate_limit'
        : status === 401 || status === 403
          ? 'unauthorized'
          : status === 404
            ? 'unsupported'
            : 'unavailable';
      return { supported: false, models: [], error: failure };
    }
  }

  async getUsage() {
    const cached = freshUsageSnapshot(this.#usageSnapshot);
    if (cached) return cached;
    const headerUsage = usageFromRateLimitHeaders(
      this.#config.providerId ?? redactedProviderId(this.#config.baseURL),
      this.#config.model,
      this.#usageHeaders ?? new Headers(),
      { plan: this.#config.providerId },
    );
    const policy = providerPolicyUsage(this.#config.providerId ?? '', this.#config.model, headerUsage.fetchedAt);
    const usage = !policy || headerUsage.windows.length === 0
      ? policy ?? headerUsage
      : {
      ...headerUsage,
      plan: policy.plan,
      windows: [...headerUsage.windows, ...policy.windows],
      detail: `${policy.detail} Live rate-limit headers are shown above when available.`,
      };
    this.#usageSnapshot = usage;
    return usage;
  }

  /**
   * Turn an SDK error into something a developer can act on.
   *
   * The status code is kept in `detail` for anyone debugging, but the message
   * says what to *do*, which is the part that matters when the loop stops at
   * three in the morning.
   */
  #translate(error: unknown): PlifError {
    const host = safeHost(this.#config.baseURL);
    const api = error as { status?: number; code?: string | null; message?: string };

    if (error instanceof StreamInterruptedError) {
      return new PlifError('MODEL_UNAVAILABLE', `${host} closed the stream early`, {
        cause: error,
        detail: { endpoint: this.#config.baseURL, reason: 'incomplete_stream' },
        hint: 'The response was incomplete. Retrying the request from the beginning.',
      });
    }

    if (error instanceof StreamIdleTimeoutError || isApiConnectionTimeoutError(error)) {
      const timeoutMs =
        error instanceof StreamIdleTimeoutError ? error.timeoutMs : this.#config.timeoutMs;
      return new PlifError('MODEL_TIMEOUT', `${host} stopped responding`, {
        cause: error,
        detail: { timeoutMs, endpoint: this.#config.baseURL, phase: 'stream' },
        hint: 'The request stalled. Retrying it from the beginning.',
      });
    }

    if (api?.status === 401 || api?.status === 403) {
      // A free model failing auth means the anonymous tier was withdrawn for it
      // or the loaded key is for a different host — never "you forgot a key",
      // which is the hint the general case wants and this case must not give.
      const anonymous = !this.#config.apiKey;
      return new PlifError(
        'MODEL_AUTH',
        anonymous
          ? `${host} would not serve "${this.#config.model}" without a key`
          : `${host} rejected the API key`,
        {
          cause: error,
          // `keyPresent` is the difference between "this key is wrong" and
          // "no key reached the request at all", and only this layer knows
          // which happened. Recovery that cannot tell them apart deletes a
          // perfectly good stored credential to fix a request that never
          // carried it — and then asks for the same key again, forever.
          detail: { status: api.status, endpoint: this.#config.baseURL, keyPresent: !anonymous },
          hint: anonymous
            ? 'This model is not on the free tier. Pick another with /model, or set a key for this endpoint.'
            : 'Check the key for this endpoint, or run `plif model` to see which one is loaded.',
        },
      );
    }
    if (api?.status === 404) {
      return new PlifError('MODEL_NOT_FOUND', `${host} has no model "${this.#config.model}"`, {
        cause: error,
        detail: { model: this.#config.model, endpoint: this.#config.baseURL },
        hint: 'Run `plif model list` to see what this endpoint offers.',
      });
    }
    if (api?.status === 429) {
      return new PlifError('MODEL_RATE_LIMIT', `${host} is rate limiting this key`, {
        cause: error,
        detail: { status: api.status, retryAfterMs: retryAfterOf(error) },
        hint: 'Wait, lower the request rate, or switch to another endpoint.',
      });
    }
    if (api?.status === 408 || api?.status === 409 || api?.status === 425) {
      return new PlifError('MODEL_UNAVAILABLE', `${host} returned retryable status ${api.status}`, {
        cause: error,
        detail: { status: api.status, retryAfterMs: retryAfterOf(error) },
        hint: 'The endpoint asked for the request to be retried.',
      });
    }
    if (api?.status !== undefined && api.status >= 500) {
      return new PlifError('MODEL_UNAVAILABLE', `${host} returned ${api.status}`, {
        cause: error,
        detail: { status: api.status },
        hint: 'The endpoint is having trouble. Retrying shortly usually works.',
      });
    }

    // The SDK wraps transport failures in APIConnectionError and buries the
    // real errno on `cause`. Without walking the chain, the single most common
    // situation — a local model server that is not running — surfaces as the
    // useless string "Connection error." instead of a hint that says which
    // port to start.
    const code = api?.code ?? errnoOf(error);
    const isConnection = isApiConnectionError(error) || TRANSIENT_ERRNOS.has(code ?? '');

    if (isConnection && !isApiConnectionTimeoutError(error)) {
      return new PlifError('MODEL_UNAVAILABLE', `could not reach ${host}`, {
        cause: error,
        detail: { code, endpoint: this.#config.baseURL },
        hint: isLocal(this.#config.baseURL)
          ? 'Is the local server running? Ollama listens on 11434, LM Studio on 1234.'
          : 'Check the base URL and your network connection.',
      });
    }
    if (code === 'ETIMEDOUT') {
      return new PlifError('MODEL_TIMEOUT', `${host} did not respond in time`, {
        cause: error,
        detail: { timeoutMs: this.#config.timeoutMs },
        hint: 'Raise PLIF_TIMEOUT_MS, or pick a faster model.',
      });
    }


    // Compatible gateways sometimes report an upstream SSE failure as an
    // APIError without an HTTP status. It is a provider/transport failure, not
    // a malformed user request, and is safe to retry before any tool executes.
    if (isApiError(error) && api.status === undefined) {
      return new PlifError('MODEL_UNAVAILABLE', `${host} interrupted the response`, {
        cause: error,
        detail: { code: api.code, endpoint: this.#config.baseURL, phase: 'stream' },
        hint: 'The upstream stream failed. Retrying the request from the beginning.',
      });
    }

    return new PlifError('MODEL_ERROR', (error as Error)?.message ?? String(error), {
      cause: error,
      detail: { endpoint: this.#config.baseURL },
    });
  }
}

function isUnsupportedReasoningEffort(error: unknown, candidate: string): boolean {
  const status = statusOf(error);
  if (status !== 400 && status !== 422) return false;
  const message = errorChainText(error).toLowerCase();
  const namesTheEndpoint = message.includes('reasoning_effort') || message.includes('reasoning effort');
  const mentionsCandidate = message.includes(candidate.toLowerCase());
  const rejection = /unsupported|not supported|invalid|unknown|unrecognized|unrecognised|must be one/.test(message);
  return namesTheEndpoint && rejection && (mentionsCandidate || message.includes('must be one'));
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  return statusOf((error as { cause?: unknown }).cause);
}

function errorChainText(error: unknown, depth = 0): string {
  if (depth > 4 || error === null || error === undefined) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return `${error.message} ${errorChainText(error.cause, depth + 1)}`;
  }
  if (typeof error === 'object') {
    const value = error as { message?: unknown; cause?: unknown; error?: unknown };
    return `${typeof value.message === 'string' ? value.message : ''} ${errorChainText(value.cause, depth + 1)} ${errorChainText(value.error, depth + 1)}`;
  }
  return String(error);
}

/**
 * Reassembles tool calls arriving in fragments.
 *
 * The wire format identifies each call by its position in the array, and only
 * the first fragment carries the id and name — every later one contributes a
 * slice of the argument string. Keying on index rather than id is therefore not
 * a shortcut; it is the only thing available.
 */
class ToolCallBuffer {
  #byIndex = new Map<number, { id: string; name: string; args: string }>();

  absorb(fragment: {
    index: number;
    id?: string | undefined;
    function?: { name?: string | undefined; arguments?: string | undefined } | undefined;
  }): void {
    const existing = this.#byIndex.get(fragment.index) ?? { id: '', name: '', args: '' };
    this.#byIndex.set(fragment.index, {
      id: fragment.id ?? existing.id,
      name: fragment.function?.name ?? existing.name,
      args: existing.args + (fragment.function?.arguments ?? ''),
    });
  }

  drain(): ToolCall[] {
    const calls = [...this.#byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        // Some compatible servers omit the id entirely. Synthesising one keeps
        // the tool-result correlation working instead of failing later with an
        // empty string nobody can trace.
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.args || '{}',
      }))
      .filter((call) => call.name !== '');
    this.#byIndex.clear();
    return calls;
  }
}

function toWire(message: Message): OpenAI.Chat.ChatCompletionMessageParam {
  switch (message.role) {
    case 'tool':
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId ?? '',
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        // Replayed verbatim, and sent even when empty.
        //
        // DeepSeek's thinking mode rejects a follow-up whose previous assistant
        // turn is missing `reasoning_content`, with a 400 that kills the run.
        // The rejection is intermittent — OpenCode Zen fans out across upstreams
        // and only some enforce it — which makes omitting the field a bug that
        // reproduces once in five runs and is miserable to chase. Sending an
        // empty string is accepted everywhere tested, so the field goes out
        // whenever the conversation is in thinking mode at all.
        ...(message.reasoning !== undefined ? { reasoning_content: message.reasoning } : {}),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: safeToolCallArguments(call.arguments) },
              })),
            }
          : {}),
      } as OpenAI.Chat.ChatCompletionMessageParam;
    case 'system':
      return { role: 'system', content: message.content };
    case 'user': {
      if (!message.attachments?.length) return { role: 'user', content: message.content };
      // The multimodal shape: an array of parts instead of a string. Text
      // first, so a model that only glances at the beginning still reads the
      // question rather than a megabyte of base64.
      return {
        role: 'user',
        content: [
          { type: 'text' as const, text: message.content },
          ...message.attachments.map((attachment) =>
            attachment.kind === 'text'
              ? { type: 'text' as const, text: attachment.text }
              : {
                  type: 'image_url' as const,
                  image_url: { url: `data:${attachment.mediaType};base64,${attachment.data}` },
                },
          ),
        ],
      };
    }
  }
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

/**
 * Dig the OS errno out of a wrapped error.
 *
 * `fetch` and the SDK both nest the original failure one or two levels down on
 * `cause`, so a direct `error.code` check misses every real transport problem.
 * Bounded depth because a malformed cause chain can be circular.
 */
function errnoOf(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 4) return undefined;
  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string') return code;
  return errnoOf((error as { cause?: unknown }).cause, depth + 1);
}

const TRANSIENT_ERRNOS = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function retryAfterOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const headers = (error as { headers?: Record<string, string> }).headers;
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);

  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function isAbort(error: unknown): boolean {
  return isUserAbortError(error);
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}
