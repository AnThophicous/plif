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

import Anthropic, { APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';

import { PlifError } from '../errors.js';
import type { Effort, ModelConfig } from './config.js';
import type {
  CompletionEvent,
  CompletionRequest,
  FinishReason,
  Message,
  ModelInfo,
  ModelProvider,
  Usage,
} from './provider.js';
import { NO_USAGE, safeToolCallArguments } from './provider.js';

/** Anthropic requires an output ceiling; Plif's config leaves it optional. */
const DEFAULT_MAX_TOKENS = 32_000;

type Block = Record<string, unknown>;

export interface AnthropicProviderOptions {
  /** Overrides the SDK's own client. Tests inject a scripted double here. */
  readonly client?: Anthropic;
}

export class AnthropicProvider implements ModelProvider {
  readonly info: ModelInfo;
  #client: Anthropic;
  #config: ModelConfig;
  /** Verbatim thinking blocks, keyed by the tool-call id of their turn. */
  #thinking = new Map<string, readonly Block[]>();

  constructor(config: ModelConfig, options: AnthropicProviderOptions = {}) {
    this.#config = config;
    this.#client =
      options.client ??
      new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.baseURL.replace(/\/v1\/?$/, ''),
        timeout: config.timeoutMs,
      });
    this.info = { id: config.model, endpoint: config.baseURL, contextWindow: undefined };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionEvent> {
    const { system, messages } = this.#toWire(request.messages);
    let stream;
    try {
      stream = this.#client.messages.stream(
        {
          model: this.#config.model,
          max_tokens: request.maxTokens ?? this.#config.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(system ? { system } : {}),
          messages: messages as never,
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.parameters as never,
                })),
              }
            : {}),
          ...(this.#config.effort
            ? { output_config: { effort: wireEffort(this.#config.effort) } }
            : {}),
        },
        request.signal ? { signal: request.signal } : {},
      );
    } catch (error) {
      throw this.#translate(error);
    }

    const thinkingBlocks: Block[] = [];
    try {
      for await (const event of stream) {
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
      if (error instanceof APIUserAbortError || request.signal?.aborted) {
        yield { kind: 'done', reason: 'cancelled', usage: NO_USAGE };
        return;
      }
      throw this.#translate(error);
    }
  }

  async probe(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.#client.messages.create({
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
    try {
      const ids: string[] = [];
      for await (const entry of this.#client.models.list()) ids.push(entry.id);
      return ids.sort();
    } catch {
      return [];
    }
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
    if (error instanceof APIConnectionTimeoutError) {
      return new PlifError('MODEL_TIMEOUT', `${host} did not answer in time`, {
        cause: error,
        detail: { timeoutMs: this.#config.timeoutMs },
        hint: 'Raise timeoutMs in your personal Plif configuration, or try again.',
      });
    }
    const status = (error as Partial<APIError> & { status?: number }).status;
    if (status === 401 || status === 403) {
      return new PlifError('MODEL_AUTH', `${host} rejected your Anthropic key`, {
        cause: error,
        hint: 'Run /model, pick the Claude provider again, and paste a valid key — or set ANTHROPIC_API_KEY.',
      });
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

function wireEffort(effort: Effort): WireEffort {
  // Plif's own tier maps onto the highest level Claude publishes below `max`,
  // which is what Anthropic recommends for coding and agentic work.
  if (effort === 'plif') return 'xhigh';
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

function usageOf(usage: { input_tokens?: number; output_tokens?: number } | undefined): Usage {
  if (!usage) return NO_USAGE;
  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
  };
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
