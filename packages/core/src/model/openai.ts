/**
 * The OpenAI-compatible provider.
 *
 * A thin translation layer over the official SDK — no retry logic, no prompt
 * templating, no token counting reimplemented. The SDK already handles
 * connection pooling, retries with backoff, and streaming; duplicating any of
 * that would be work spent building a worse version of something that ships in
 * the box.
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

import OpenAI from 'openai';
import type { APIError } from 'openai';

import { PlifError } from '../errors.js';
import type { ModelConfig } from './config.js';
import { isLocal } from './config.js';
import { ReasoningDeltaNormalizer, ReasoningSplitter, reasoningFromDelta } from './reasoning.js';
import type {
  CompletionEvent,
  CompletionRequest,
  FinishReason,
  Message,
  ModelInfo,
  ModelProvider,
  ToolCall,
  Usage,
} from './provider.js';
import { NO_USAGE, safeToolCallArguments } from './provider.js';

/** Attempts, including the first. Ten of them span roughly four minutes. */
const RETRY_ATTEMPTS = 10;
/** First wait, and the step. 5s, 10s, 15s, … */
const RETRY_BASE_MS = 5_000;

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
  constructor() {
    super('stream ended before the endpoint sent a finish reason');
    this.name = 'StreamInterruptedError';
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

export class OpenAIProvider implements ModelProvider {
  readonly info: ModelInfo;
  #client: OpenAI;
  #config: ModelConfig;

  constructor(config: ModelConfig) {
    this.#config = config;
    this.#client = new OpenAI({
      // Empty, not a placeholder. The SDK only rejects `undefined`, and an
      // empty string sends a bare `Authorization: Bearer` — which a host with
      // an anonymous tier accepts. A stand-in like "unused" does not read as
      // "no credential" to a gateway; it reads as a wrong one, and comes back
      // 401 on exactly the models that were supposed to need nothing.
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      // The SDK retries idempotent failures on its own; two is enough to ride
      // out a blip without making a wedged endpoint take a minute to report.
      maxRetries: 2,
    });
    this.info = {
      id: config.model,
      endpoint: config.baseURL,
      contextWindow: undefined,
    };
  }

  /**
   * Stream, and keep trying when the endpoint is the thing that broke.
   *
   * The SDK already retries a failed *request*, but not a failed *stream* — and
   * the failure that actually costs a session is the one that arrives mid-flight
   * with a 500. OpenCode Zen fans out across upstreams, so a bad minute on one
   * of them surfaces as `Internal server error: function_call arguments JSON
   * parse error` and kills a turn that was thirty seconds in. That is worth
   * waiting out rather than handing back to the developer.
   *
   * The backoff is linear, not exponential: 5s, 10s, 15s and so on to ten
   * attempts, about four minutes in total. Linear because the thing being
   * waited out is an upstream blip measured in seconds, and an exponential
   * curve spends its last two attempts asleep for longer than the whole outage.
   *
   * Only failures that could plausibly clear on their own are retried. A
   * rejected key or an unknown model id will be just as rejected in forty-five
   * seconds, and burning four minutes to say so is worse than saying it now.
   */
  async *stream(request: CompletionRequest): AsyncGenerator<CompletionEvent> {
    let delivered = false;

    for (let attempt = 1; ; attempt += 1) {
      try {
        for await (const event of this.#attempt(request)) {
          if (event.kind !== 'done') delivered = true;
          yield event;
        }
        return;
      } catch (error) {
        const plif = this.#translate(error);
        const last = attempt >= RETRY_ATTEMPTS;

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

        const waitMs = RETRY_BASE_MS * attempt;
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
          await sleep(waitMs, request.signal);
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
  protected createStream(
    body: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    options: { signal?: AbortSignal },
  ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>> {
    return this.#client.chat.completions.create(body, options) as unknown as Promise<
      AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
    >;
  }

  async *#attempt(request: CompletionRequest): AsyncGenerator<CompletionEvent> {
    const pending = new ToolCallBuffer();
    // Two channels arrive as one on models that write `<think>` into content.
    // Splitting here rather than in the loop means every consumer — the TUI,
    // the print path, a test — sees the same two kinds of event whichever way
    // the host happens to frame it.
    const splitter = new ReasoningSplitter();
    const reasoningDeltas = new ReasoningDeltaNormalizer();
    let reason: FinishReason = 'stop';
    let usage: Usage = NO_USAGE;
    let finished = false;

    try {
      const response = await this.createStream(
        {
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
          ...(this.#config.effort
            ? { reasoning_effort: this.#config.effort === 'xhigh' ? 'high' : this.#config.effort }
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
        },
        request.signal ? { signal: request.signal } : {},
      );

      for await (const chunk of response) {
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const text = choice.delta?.content;
        if (text) {
          for (const part of splitter.push(text)) {
            yield { kind: part.kind, delta: part.delta };
          }
        }

        // Reasoning models put their thinking on a side field, and no two hosts
        // agree on which one. None of them are in the SDK types.
        const thinking = reasoningFromDelta(choice.delta);
        if (thinking) {
          const delta = reasoningDeltas.push(thinking);
          if (delta) yield { kind: 'reasoning', delta };
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
      for (const call of pending.drain()) {
        yield { kind: 'tool', call };
      }

      yield { kind: 'done', reason, usage };
    } catch (error) {
      if (isAbort(error)) {
        yield { kind: 'done', reason: 'cancelled', usage };
        return;
      }
      // Raw, not translated. The retry loop above translates once and needs the
      // code to decide whether another attempt could possibly help.
      throw error;
    }
  }

  async probe(): Promise<{ ok: boolean; detail: string }> {
    try {
      // One token is enough to prove the endpoint, the model id and the key are
      // all good — and costs essentially nothing on a metered API.
      await this.#client.chat.completions.create({
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
    try {
      const models = await this.#client.models.list();
      return models.data.map((model) => model.id).sort();
    } catch {
      // Plenty of compatible servers do not implement /models. That is not an
      // error worth surfacing — it just means we cannot offer a picker.
      return [];
    }
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
    const api = error as Partial<APIError> & { status?: number; code?: string };

    if (error instanceof StreamInterruptedError) {
      return new PlifError('MODEL_UNAVAILABLE', `${host} closed the stream early`, {
        cause: error,
        detail: { endpoint: this.#config.baseURL, reason: 'incomplete_stream' },
        hint: 'The response was incomplete. Retrying the request from the beginning.',
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
          detail: { status: api.status, endpoint: this.#config.baseURL },
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
        detail: { status: 429 },
        hint: 'Wait, lower the request rate, or switch to another endpoint.',
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
    const isConnection =
      (error as Error)?.name === 'APIConnectionError' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN';

    if (isConnection && (error as Error)?.name !== 'APIConnectionTimeoutError') {
      return new PlifError('MODEL_UNAVAILABLE', `could not reach ${host}`, {
        cause: error,
        detail: { code, endpoint: this.#config.baseURL },
        hint: isLocal(this.#config.baseURL)
          ? 'Is the local server running? Ollama listens on 11434, LM Studio on 1234.'
          : 'Check the base URL and your network connection.',
      });
    }
    if (code === 'ETIMEDOUT' || (error as Error)?.name === 'APIConnectionTimeoutError') {
      return new PlifError('MODEL_TIMEOUT', `${host} did not respond in time`, {
        cause: error,
        detail: { timeoutMs: this.#config.timeoutMs },
        hint: 'Raise PLIF_TIMEOUT_MS, or pick a faster model.',
      });
    }

    return new PlifError('MODEL_ERROR', (error as Error)?.message ?? String(error), {
      cause: error,
      detail: { endpoint: this.#config.baseURL },
    });
  }
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

function isAbort(error: unknown): boolean {
  const name = (error as Error)?.name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}
