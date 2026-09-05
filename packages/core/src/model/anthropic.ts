/**
 * The Anthropic provider.
 *
 * Claude does not speak the OpenAI wire format, so this is a real adapter
 * rather than a base URL swap: system text is a separate parameter, tool
 * results ride on user turns, and thinking is a first-class content block.
 *
 * The one genuinely subtle part is thinking replay. Claude returns thinking
 * blocks carrying a signature, and the API rejects a follow-up request whose
 * thinking blocks have been rewritten. Plif's transcript keeps only the text,
 * so the blocks are cached here against the tool-call ids of the turn that
 * produced them and put back verbatim on replay. Turns without tool calls end
 * the exchange, and are never replayed with their thinking required, so they
 * need no entry.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';

import { dispatcherFor } from './proxy.js';
import { isApiConnectionTimeoutError, isUserAbortError } from './sdk-errors.js';

import { PlifError } from '../errors.js';
import type { Effort, ModelConfig } from './config.js';
import type {
  CompletionEvent,
  CompletionRequest,
  FinishReason,
  Message,
  ModelListResult,
  ModelInfo,
  ModelProvider,
  ProviderModel,
  Usage,
} from './provider.js';
import { NO_USAGE, safeToolCallArguments } from './provider.js';
import { modelListResult, normalizeProviderModel } from './metadata.js';
import {
  freshUsageSnapshot,
  providerPolicyUsage,
  usageFromRateLimitHeaders,
  type UsageInfo,
} from './usage.js';
import { normalizeAnthropicUsage } from './token-usage.js';

/** An endpoint that does not understand cache breakpoints says so in the 400. */
function mentionsCacheControl(error: unknown): boolean {
  // The provider translates transport failures into PlifError before they
  // leave the generator, so the original is reached through `cause`.
  const candidates = [error, (error as { cause?: unknown }).cause];
  return candidates.some((candidate) => {
    if (!candidate) return false;
    const status = (candidate as { status?: number }).status;
    if (status !== undefined && status !== 400 && status !== 404 && status !== 422) return false;
    return /cache[_ -]?control|prompt cach/i.test(
      String((candidate as { message?: string }).message ?? ''),
    );
  });
}

/** Anthropic requires an output ceiling; Plif's config leaves it optional. */
const DEFAULT_MAX_TOKENS = 32_000;

type Block = Record<string, unknown>;

export interface AnthropicProviderOptions {
  /** Overrides the SDK's own client. Tests inject a scripted double here. */
  readonly client?: Anthropic;
}

export class AnthropicProvider implements ModelProvider {
  readonly info: ModelInfo;
  /**
   * Built on first use. Importing the SDK is ~95ms of module loading, and a
   * session that never talks to Anthropic should never pay it.
   */
  #client: Anthropic | undefined;
  #clientPromise: Promise<Anthropic> | undefined;
  #clientOptions: ClientOptions | undefined;
  #config: ModelConfig;
  #usageHeaders: Headers | undefined;
  #usageSnapshot: UsageInfo | undefined;
  /** Verbatim thinking blocks, keyed by the tool-call id of their turn. */
  #thinking = new Map<string, readonly Block[]>();
  /**
   * Whether to ask the endpoint to cache the stable prefix of the request.
   *
   * Turned off for the rest of the run if an endpoint rejects the field, so a
   * gateway that only speaks a subset of the Messages API degrades to plain
   * requests instead of failing every turn.
   */
  #caching = true;

  constructor(config: ModelConfig, options: AnthropicProviderOptions = {}) {
    this.#config = config;
    type SdkFetch = NonNullable<ClientOptions['fetch']>;
    const captureFetch = (async (...args: Parameters<SdkFetch>): Promise<Awaited<ReturnType<SdkFetch>>> => {
      // `dispatcher` is Node's own extension to RequestInit and is absent from
      // the DOM typings the SDK's fetch signature is written against; it is
      // undefined and inert when nothing configured a proxy.
      const [input, init] = args as Parameters<typeof globalThis.fetch>;
      const dispatcher = await dispatcherFor(config.baseURL);
      const response = await globalThis.fetch(
        input,
        (dispatcher ? { ...init, dispatcher } : init) as RequestInit,
      );
      this.#usageHeaders = new globalThis.Headers(response.headers);
      this.#usageSnapshot = undefined;
      return response as unknown as Awaited<ReturnType<SdkFetch>>;
    }) as SdkFetch;
    this.#client = options.client;
    this.#clientOptions = {
      apiKey: config.apiKey,
      baseURL: config.baseURL.replace(/\/v1\/?$/, ''),
      timeout: config.timeoutMs,
      fetch: captureFetch,
      // See the OpenAI adapter: gateway headers are endpoint defaults.
      ...(config.headers ? { defaultHeaders: { ...config.headers } } : {}),
    };
    this.info = {
      id: config.model,
      ...(config.providerId ? { providerId: config.providerId } : {}),
      endpoint: config.baseURL,
      contextWindow: config.contextWindow,
      ...(config.maxTokens === undefined ? {} : { maxOutputTokens: config.maxTokens }),
      capabilities: {
        usageSemantics: 'anthropic-messages',
        cacheSupport: 'reported',
        cacheAccounting: 'separate-if-reported',
        reasoningAccounting: 'reported',
      },
    };
  }

  /** The SDK client, imported and constructed on first use. */
  async #anthropic(): Promise<Anthropic> {
    if (this.#client) return this.#client;
    this.#clientPromise ??= import('@anthropic-ai/sdk').then(({ default: AnthropicClient }) => {
      this.#client = new AnthropicClient(this.#clientOptions);
      this.#clientOptions = undefined;
      return this.#client;
    });
    return await this.#clientPromise;
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionEvent> {
    // An endpoint that does not understand cache breakpoints must cost one
    // rejected request, not every turn of the session. The retry is only
    // allowed before the first event arrives, so nothing is ever emitted twice.
    const state = { started: false };
    try {
      yield* this.#attempt(request, state);
      return;
    } catch (error) {
      if (!this.#caching || state.started || !mentionsCacheControl(error)) throw error;
      this.#caching = false;
    }
    yield* this.#attempt(request, { started: false });
  }

  async *#attempt(
    request: CompletionRequest,
    state: { started: boolean },
  ): AsyncGenerator<CompletionEvent> {
    let stream;
    try {
      stream = (await this.#anthropic()).messages.stream(
        this.#body(request) as never,
        request.signal ? { signal: request.signal } : {},
      );
    } catch (error) {
      throw this.#translate(error);
    }

    const thinkingBlocks: Block[] = [];
    try {
      for await (const event of stream) {
        // The request opened. From here a failure is a mid-stream failure, and
        // re-running it would duplicate whatever has already been yielded.
        state.started = true;
        if (event.type !== 'content_block_delta') continue;
        const delta = event.delta as { type: string; text?: string; thinking?: string };
        if (delta.type === 'text_delta' && delta.text) {
          yield { kind: 'text', delta: delta.text };
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          yield { kind: 'reasoning', delta: delta.thinking };
        }
      }

      const final = await stream.finalMessage();
      const toolIds: string[] = [];
      for (const block of final.content as unknown as Block[]) {
        if (block['type'] === 'thinking' || block['type'] === 'redacted_thinking') {
          thinkingBlocks.push(block);
        } else if (block['type'] === 'tool_use') {
          const id = String(block['id']);
          toolIds.push(id);
          yield {
            kind: 'tool',
            call: {
              id,
              name: String(block['name']),
              arguments: safeToolCallArguments(JSON.stringify(block['input'] ?? {})),
            },
          };
        }
      }
      // Only a turn that asked for tools gets replayed with its thinking still
      // required, and that turn always has at least one id to key on.
      if (thinkingBlocks.length > 0 && toolIds[0]) {
        this.#thinking.set(toolIds[0], thinkingBlocks);
      }

      yield {
        kind: 'done',
        reason: finishReason(final.stop_reason),
        usage: usageOf(final.usage),
      };
    } catch (error) {
      if (isUserAbortError(error) || request.signal?.aborted) {
        yield { kind: 'done', reason: 'cancelled', usage: NO_USAGE };
        return;
      }
      throw this.#translate(error);
    }
  }

  async probe(): Promise<{ ok: boolean; detail: string }> {
    try {
      await (await this.#anthropic()).messages.create({
        model: this.#config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true, detail: `${this.#config.model} responded` };
    } catch (error) {
      return { ok: false, detail: this.#translate(error).message };
    }
  }

  async list(): Promise<string[]> {
    const result = await this.listModels();
    return result.models.map((model) => model.id).sort();
  }

  withEffort(effort: import('./config.js').Effort): ModelProvider {
    return new AnthropicProvider({ ...this.#config, effort });
  }

  async listModels(): Promise<ModelListResult> {
    try {
      const models: ProviderModel[] = [];
      for await (const entry of (await this.#anthropic()).models.list()) {
        const raw = entry as unknown as Record<string, unknown>;
        const id = typeof raw['id'] === 'string' ? raw['id'] : '';
        if (!id) continue;
        const normalized = normalizeProviderModel(raw, this.#config, { nameKeys: ['display_name', 'name'] });
        if (normalized) models.push(normalized);
      }
      return modelListResult(this.#config, models);
    } catch (error) {
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
      this.#config.providerId ?? 'anthropic',
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
   * Plif's flat message list, as Claude wants it.
   *
   * Two shape changes matter. System turns leave the list entirely — Claude
   * takes them as a separate parameter — and consecutive tool results collapse
   * into a single user turn, because Claude requires every result from one
   * parallel batch to arrive together. Splitting them across turns is accepted
   * and then quietly teaches the model to stop calling tools in parallel.
   */
  /**
   * The request body, with cache breakpoints on the parts that repeat.
   *
   * A turn re-sends the same tools and system prompt every time - together
   * about 16k tokens here - plus a conversation that only ever grows at the
   * end. Anthropic caches whatever precedes a breakpoint, and three cover it:
   * the tool list, which never varies; the system prompt, whose tail carries
   * the session's memory and notes and so occasionally does; and the final
   * message, which is the prefix the *next* turn reads back. Cached input is
   * billed at a tenth of the normal rate, and the usage the provider already
   * reports shows how much of each turn actually hit.
   */
  #body(request: CompletionRequest): Record<string, unknown> {
    const { system, messages } = this.#toWire(request.messages);
    const breakpoint = { cache_control: { type: 'ephemeral' } } as const;
    if (this.#caching) {
      // The final block of the final message. Every later turn keeps this exact
      // prefix, so the boundary moves forward one turn at a time.
      const last = messages.at(-1)?.['content'];
      if (Array.isArray(last) && last.length > 0) {
        const block = last.at(-1) as Block;
        last[last.length - 1] = { ...block, ...breakpoint };
      }
    }
    const tools = request.tools?.length
      ? request.tools.map((tool, index) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters as never,
          // The tool list is the one part of the prefix that never varies with
          // session state, so it gets its own breakpoint: a turn that changed
          // the system prompt - remembering something, loading a skill - still
          // reads these back instead of re-sending them.
          ...(this.#caching && index === request.tools!.length - 1
            ? { cache_control: { type: 'ephemeral' } }
            : {}),
        }))
      : undefined;
    return {
      model: this.#config.model,
      max_tokens: request.maxTokens ?? this.#config.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(system
        ? {
            system: this.#caching
              ? [{ type: 'text', text: system, ...breakpoint }]
              : system,
          }
        : {}),
      messages,
      ...(tools ? { tools } : {}),
      ...(this.#config.effort
        ? { output_config: { effort: anthropicWireEffort(this.#config.effort) } }
        : {}),
    };
  }

  #toWire(messages: readonly Message[]): { system: string; messages: Block[] } {
    const system: string[] = [];
    const wire: Block[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        if (message.content) system.push(message.content);
        continue;
      }

      if (message.role === 'tool') {
        const result: Block = {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          content: message.content || '(no output)',
        };
        const previous = wire.at(-1);
        if (previous?.['role'] === 'user' && Array.isArray(previous['content'])
          && (previous['content'] as Block[]).every((block) => block['type'] === 'tool_result')) {
          (previous['content'] as Block[]).push(result);
        } else {
          wire.push({ role: 'user', content: [result] });
        }
        continue;
      }

      if (message.role === 'user') {
        const content: Block[] = [];
        for (const attachment of message.attachments ?? []) {
          if (attachment.kind === 'image') {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data },
            });
          } else {
            content.push({ type: 'text', text: `${attachment.name}\n${attachment.text}` });
          }
        }
        if (message.content) content.push({ type: 'text', text: message.content });
        if (content.length === 0) content.push({ type: 'text', text: '(empty)' });
        wire.push({ role: 'user', content });
        continue;
      }

      const content: Block[] = [];
      const firstCall = message.toolCalls?.[0]?.id;
      // Thinking must precede everything else in the turn it belongs to.
      if (firstCall) content.push(...(this.#thinking.get(firstCall) ?? []));
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: JSON.parse(safeToolCallArguments(call.arguments)),
        });
      }
      if (content.length === 0) continue;
      wire.push({ role: 'assistant', content });
    }

    return { system: system.join('\n\n'), messages: wire };
  }

  #translate(error: unknown): PlifError {
    const host = safeHost(this.#config.baseURL);
    if (isApiConnectionTimeoutError(error)) {
      return new PlifError('MODEL_TIMEOUT', `${host} did not answer in time`, {
        cause: error,
        detail: { timeoutMs: this.#config.timeoutMs },
        hint: 'Raise timeoutMs in your personal Plif configuration, or try again.',
      });
    }
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) {
      // See the OpenAI adapter: `keyPresent` separates a rejected key from a
      // request that carried none, so recovery does not delete a credential
      // that was never sent.
      const keyPresent = Boolean(this.#config.apiKey);
      return new PlifError(
        'MODEL_AUTH',
        keyPresent ? `${host} rejected your Anthropic key` : `${host} refused a request with no key`,
        {
          cause: error,
          detail: { status, endpoint: this.#config.baseURL, keyPresent },
          hint: keyPresent
            ? 'Run /model, pick the Claude provider again, and paste a valid key — or set ANTHROPIC_API_KEY.'
            : 'The stored credential did not reach this request. Run /model to reselect the provider.',
        },
      );
    }
    if (status === 404) {
      return new PlifError('MODEL_NOT_FOUND', `${host} does not serve "${this.#config.model}"`, {
        cause: error,
        hint: 'Run /model to pick a model this account can reach.',
      });
    }
    if (status === 429) {
      return new PlifError('MODEL_RATE_LIMIT', `${host} is rate limiting this key`, {
        cause: error,
        hint: 'Wait for the limit to reset, or pick a different model with /model.',
      });
    }
    if (status !== undefined && status >= 500) {
      return new PlifError('MODEL_UNAVAILABLE', `${host} returned ${status}`, { cause: error });
    }
    return new PlifError('MODEL_ERROR', messageOf(error, host), { cause: error });
  }
}

type WireEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function anthropicWireEffort(effort: Effort): WireEffort {
  // Plif asks for the strongest level this adapter knows how to send. Unlike
  // the OpenAI-compatible path, Anthropic exposes one known effort vocabulary,
  // so there is no endpoint-specific negotiation ladder to run here.
  if (effort === 'plif') return 'max';
  if (effort === 'ultracode') return 'max';
  if (effort === 'ultra' || effort === 'max') return 'max';
  return effort;
}

function finishReason(reason: string | null): FinishReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'stop';
    default:
      return 'stop';
  }
}

function usageOf(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
} | undefined): Usage {
  if (!usage) return NO_USAGE;
  return normalizeAnthropicUsage(usage) ?? NO_USAGE;
}

function messageOf(error: unknown, host: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${host}: ${detail}`;
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}
