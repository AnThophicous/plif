/**
 * The model boundary.
 *
 * One interface, so the agent loop never imports a vendor SDK. That matters
 * less for portability than it does for testability: a loop written against
 * `ModelProvider` can be driven by a scripted fake in a unit test, and the
 * learning harness can be exercised without a network call or an API key.
 *
 * The shape is deliberately OpenAI-flavoured — messages, tools, streamed
 * deltas — because that wire format has become the lingua franca. Anything that
 * speaks it (OpenAI, Ollama, LM Studio, vLLM, OpenRouter, Groq, DeepSeek,
 * together.ai) plugs in by changing a base URL, not by writing an adapter.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * An image travelling with a user message.
 *
 * Base64 rather than a path, because the path is meaningless to the endpoint
 * and the container the agent runs in cannot reach the host temp directory
 * where a pasted screenshot lands. The file on disk is for the developer to
 * re-open; this is what actually goes on the wire.
 */
export interface ImageAttachment {
  readonly kind: 'image';
  readonly mediaType: string;
  /** Base64, no data-URI prefix. */
  readonly data: string;
  /** What to call it on screen, and in the text the model sees. */
  readonly name: string;
}

/** Text supplied beside the compact marker shown in the terminal. */
export interface TextAttachment {
  readonly kind: 'text';
  /** The compact marker the developer saw, e.g. `[Pasted Content #1 - 3 Lines]`. */
  readonly name: string;
  /** Complete clipboard payload. This is what the model reads. */
  readonly text: string;
}

export type Attachment = ImageAttachment | TextAttachment;

export interface Message {
  readonly role: Role;
  readonly content: string;
  /**
   * Pasted content sent with this message.
   *
   * Only meaningful on `user` messages. Text attachments are emitted in full;
   * images retain their native multimodal payload.
   */
  readonly attachments?: readonly Attachment[];
  /** Set on `tool` messages: which call this is the result of. */
  readonly toolCallId?: string;
  /** Set on `assistant` messages that requested tools. */
  readonly toolCalls?: readonly ToolCall[];
  /**
   * The model's thinking, for reasoning models.
   *
   * Not decoration. DeepSeek's thinking mode *rejects* a follow-up request that
   * omits the `reasoning_content` from the previous assistant turn — the second
   * tool round-trip fails with a 400 and the whole run dies. So this is carried
   * on the message and replayed on the wire, not thrown away after display.
   */
  readonly reasoning?: string;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw JSON string as the model emitted it — parsed by the caller, not here. */
  readonly arguments: string;
}

/** Keep malformed model output out of assistant history and provider payloads. */
export function safeToolCallArguments(raw: string): string {
  try {
    JSON.parse(raw || '{}');
    return raw || '{}';
  } catch {
    return '{}';
  }
}

/**
 * A tool the model may ask to use.
 *
 * `parameters` is a JSON Schema object. It is passed through untouched: the
 * provider's job is transport, and rewriting a schema on the way out is how you
 * end up debugging why the model calls a tool with the wrong shape.
 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSpec[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

/**
 * Streamed output.
 *
 * Text arrives as deltas so the interface can render while the model is still
 * thinking; tool calls arrive assembled, because a half-parsed JSON argument is
 * useless to anyone and the provider is the right place to buffer it.
 */
export type CompletionEvent =
  | { readonly kind: 'text'; readonly delta: string }
  /** Thinking, from a reasoning model. Must be fed back on the next request. */
  | { readonly kind: 'reasoning'; readonly delta: string }
  | { readonly kind: 'tool'; readonly call: ToolCall }
  /**
   * The endpoint failed and another attempt is coming after `waitMs`.
   *
   * Informational: the consumer does not act on it beyond telling the human
   * that the wait is a retry and not a hang. A four-minute silence with a
   * spinner on it is indistinguishable from a wedged process.
   */
  | {
      readonly kind: 'retry';
      readonly attempt: number;
      readonly of: number;
      readonly waitMs: number;
      readonly reason: string;
    }
  /**
   * Throw away everything this turn has emitted; it is being redone.
   *
   * Only sent when a retry follows a partially delivered stream. Without it a
   * retry would append a second copy of a half-written answer to the first,
   * and the model would be sent both as its own previous turn.
   */
  | { readonly kind: 'reset' }
  | { readonly kind: 'done'; readonly reason: FinishReason; readonly usage: Usage };

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'cancelled' | 'error';

export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export const NO_USAGE: Usage = Object.freeze({ promptTokens: 0, completionTokens: 0 });

export interface ModelInfo {
  readonly id: string;
  /** Stable provider identity, kept apart from the model id for capabilities. */
  readonly providerId?: string;
  /** Where it is served from, for display. Never includes credentials. */
  readonly endpoint: string;
  /** Context window in tokens, if the provider reports or we know it. */
  readonly contextWindow: number | undefined;
}

/** Wire protocol selected by an explicit provider/model offer. */
export type ModelProtocol = 'openai-chat' | 'anthropic-messages';

/** Whether a streamed text field is incremental or a complete snapshot. */
export type StreamSemantics = 'delta' | 'snapshot';

/** Provenance carried from discovery to the picker and request adapter. */
export interface ModelSource {
  readonly provider?: string;
  readonly product?: string;
  readonly tier?: string;
  readonly endpoint?: string;
}

/** Metadata returned by a provider's model-list endpoint when it is known. */
export interface ProviderModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly modalities?: readonly ('text' | 'image')[];
  readonly cost?: 'free' | 'paid' | 'unknown';
  readonly provider?: string;
  readonly product?: string;
  readonly tier?: string;
  readonly protocol?: ModelProtocol;
  readonly streamSemantics?: StreamSemantics;
}

/** Listing support is distinct from an empty successful catalog. */
export interface ModelListResult {
  readonly supported: boolean;
  readonly models: readonly ProviderModel[];
  readonly source?: ModelSource;
  readonly error?: 'rate_limit' | 'unauthorized' | 'unavailable' | 'unsupported';
}

export interface ModelProvider {
  readonly info: ModelInfo;
  /** Stream a completion. Throws `PlifError` with a MODEL_* code on failure. */
  stream(request: CompletionRequest): AsyncGenerator<CompletionEvent>;
  /** Cheap liveness check: can we reach the endpoint and is the key accepted? */
  probe(): Promise<{ ok: boolean; detail: string }>;
  /** Model ids the endpoint advertises. Empty when it does not support listing. */
  list(): Promise<string[]>;
  /** Rich listing result. Older/test providers may implement only list(). */
  readonly listModels?: () => Promise<ModelListResult>;
}

/**
 * Collect a stream into one result.
 *
 * For one-shot calls and for tests. Anything interactive should consume the
 * generator directly — buffering it defeats the point of streaming.
 */
export async function collect(stream: AsyncGenerator<CompletionEvent>): Promise<{
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  reason: FinishReason;
  usage: Usage;
}> {
  let text = '';
  let reasoning = '';
  const toolCalls: ToolCall[] = [];
  let reason: FinishReason = 'error';
  let usage: Usage = NO_USAGE;

  for await (const event of stream) {
    if (event.kind === 'text') text += event.delta;
    else if (event.kind === 'reasoning') reasoning += event.delta;
    else if (event.kind === 'tool') toolCalls.push(event.call);
    else if (event.kind === 'retry') continue;
    else if (event.kind === 'reset') {
      // The attempt that produced this is being redone from scratch. Keeping
      // any of it would concatenate two answers.
      text = '';
      reasoning = '';
      toolCalls.length = 0;
    } else {
      reason = event.reason;
      usage = event.usage;
    }
  }
  return { text, reasoning, toolCalls, reason, usage };
}
