import { createHash } from 'node:crypto';

import type { Message, ToolSpec } from '../model/provider.js';

export type ContextPressure = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export interface ContextBreakdown {
  readonly systemTokens: number;
  readonly conversationTokens: number;
  readonly toolResultTokens: number;
  readonly summaryTokens: number;
  readonly toolSchemaTokens: number;
  readonly totalInputTokens: number;
  /** Tokens that belong to the stable prefix when the provider can cache it. */
  readonly cacheEligibleTokens: number;
  readonly stablePrefixHash: string;
}

export interface ContextBudget {
  readonly contextWindow: number | undefined;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly availableInputBudget: number | undefined;
  readonly effectiveInputTokens: number;
  readonly pressure: ContextPressure;
  readonly breakdown: ContextBreakdown;
}

export interface ContextBudgetOptions {
  readonly contextWindow?: number;
  readonly reservedOutputTokens?: number;
  readonly safetyMarginTokens?: number;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSpec[];
  /**
   * Internal fast path for the harness' append-only message ledger. Callers
   * that can replace arbitrary entries must leave this unset.
   */
  readonly appendOnly?: boolean;
}

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1_000;
const MAX_CACHED_TEXT_CHARS = 64 * 1024;
const MAX_CACHED_TEXT_ENTRIES = 10_000;
const MESSAGE_CHAR_CACHE = new WeakMap<object, number>();
const TOOL_SCHEMA_TOKEN_CACHE = new WeakMap<object, number>();
const TOOL_SCHEMA_TEXT_CACHE = new WeakMap<object, string>();
const OBJECT_ID_CACHE = new WeakMap<object, number>();
const PREFIX_HASH_CACHE = new WeakMap<object, Map<string, string>>();
interface MessageTotalsCache {
  count: number;
  lastMessage: Message | undefined;
  totalChars: number;
  systemChars: number;
  toolResultChars: number;
  summaryChars: number;
  system: Message[];
}

const MESSAGE_TOTALS_CACHE = new WeakMap<object, MessageTotalsCache>();
let nextObjectId = 1;
/**
 * Short, immutable message bodies recur often in compaction and spill
 * accounting. Keep this cache bounded and exact: the string itself is the
 * key, so a hash collision can never change a token estimate. Large bodies
 * are deliberately excluded because retaining them costs more than counting
 * their length once.
 */
const TEXT_CHAR_CACHE = new Map<string, number>();

function rememberTextChars(text: string, chars: number): void {
  if (text.length > MAX_CACHED_TEXT_CHARS) return;
  if (TEXT_CHAR_CACHE.has(text)) TEXT_CHAR_CACHE.delete(text);
  TEXT_CHAR_CACHE.set(text, chars);
  while (TEXT_CHAR_CACHE.size > MAX_CACHED_TEXT_ENTRIES) {
    const oldest = TEXT_CHAR_CACHE.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    TEXT_CHAR_CACHE.delete(oldest);
  }
}

function estimateMessageChars(message: Message): number {
  const cached = MESSAGE_CHAR_CACHE.get(message);
  if (cached !== undefined) return cached;

  const simple = message.reasoning === undefined &&
    (message.toolCalls?.length ?? 0) === 0 &&
    (message.attachments?.length ?? 0) === 0;
  if (simple) {
    const cachedText = TEXT_CHAR_CACHE.get(message.content);
    if (cachedText !== undefined) {
      // Refresh the entry so repeated prompt fragments stay hot without
      // allowing the map to grow beyond its fixed cap.
      TEXT_CHAR_CACHE.delete(message.content);
      TEXT_CHAR_CACHE.set(message.content, cachedText);
      return cachedText;
    }
  }

  let chars = message.content.length;
  chars += message.reasoning?.length ?? 0;
  for (const call of message.toolCalls ?? []) {
    chars += call.name.length + call.arguments.length;
  }
  for (const attachment of message.attachments ?? []) {
    chars += attachment.kind === 'text'
      ? attachment.name.length + attachment.text.length
      : IMAGE_TOKENS * CHARS_PER_TOKEN;
  }
  const total = chars + 16;
  MESSAGE_CHAR_CACHE.set(message, total);
  if (simple) rememberTextChars(message.content, total);
  return total;
}

/** A conservative local estimate used only when the provider omits usage. */
export function estimateTokens(messages: readonly Message[]): number {
  const chars = messages.reduce((total, message) => total + estimateMessageChars(message), 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function estimateToolTokens(tools: readonly ToolSpec[]): number {
  const cached = TOOL_SCHEMA_TOKEN_CACHE.get(tools);
  if (cached !== undefined) return cached;
  const tokens = Math.ceil(toolSchemaText(tools).length / CHARS_PER_TOKEN);
  TOOL_SCHEMA_TOKEN_CACHE.set(tools, tokens);
  return tokens;
}

function toolSchemaText(tools: readonly ToolSpec[]): string {
  const cached = TOOL_SCHEMA_TEXT_CACHE.get(tools);
  if (cached !== undefined) return cached;
  const serialized = stableSerialize(tools);
  TOOL_SCHEMA_TEXT_CACHE.set(tools, serialized);
  return serialized;
}

function objectId(value: object): number {
  const cached = OBJECT_ID_CACHE.get(value);
  if (cached !== undefined) return cached;
  const id = nextObjectId++;
  OBJECT_ID_CACHE.set(value, id);
  return id;
}

function stablePrefixHash(system: readonly Message[], tools: readonly ToolSpec[]): string {
  const toolKey = tools as object;
  let variants = PREFIX_HASH_CACHE.get(toolKey);
  if (!variants) {
    variants = new Map();
    PREFIX_HASH_CACHE.set(toolKey, variants);
  }
  // Message and ToolSpec values are readonly by contract. Replacement of a
  // system message gets a new identity and therefore a new cache key; the
  // existing WeakMap message cache follows the same immutability contract.
  const key = system.map((message) => objectId(message)).join(',');
  const cached = variants.get(key);
  if (cached !== undefined) return cached;

  const stablePrefix = JSON.stringify({
    system: stableValue(system),
    tools: toolSchemaText(tools),
  });
  const hash = createHash('sha256').update(stablePrefix).digest('hex').slice(0, 16);
  variants.set(key, hash);
  while (variants.size > 8) {
    const oldest = variants.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    variants.delete(oldest);
  }
  return hash;
}

function isSummary(message: Message): boolean {
  return message.content.trimStart().startsWith('[continuity capsule ');
}

function messageTotals(messages: readonly Message[], appendOnly: boolean): MessageTotalsCache {
  const key = messages as object;
  const cached = MESSAGE_TOTALS_CACHE.get(key);
  const canAppend = cached !== undefined &&
    appendOnly &&
    messages.length >= cached.count &&
    (cached.count === 0 || messages[cached.count - 1] === cached.lastMessage);

  if (canAppend && cached) {
    for (let index = cached.count; index < messages.length; index += 1) {
      const message = messages[index]!;
      const chars = estimateMessageChars(message);
      cached.totalChars += chars;
      if (message.role === 'system') {
        cached.systemChars += chars;
        cached.system.push(message);
      }
      if (message.role === 'tool') cached.toolResultChars += chars;
      if (isSummary(message)) cached.summaryChars += chars;
    }
    cached.count = messages.length;
    cached.lastMessage = messages.at(-1);
    return cached;
  }

  const next: MessageTotalsCache = {
    count: 0,
    lastMessage: undefined,
    totalChars: 0,
    systemChars: 0,
    toolResultChars: 0,
    summaryChars: 0,
    system: [],
  };
  for (const message of messages) {
    const chars = estimateMessageChars(message);
    next.totalChars += chars;
    if (message.role === 'system') {
      next.systemChars += chars;
      next.system.push(message);
    }
    if (message.role === 'tool') next.toolResultChars += chars;
    if (isSummary(message)) next.summaryChars += chars;
  }
  next.count = messages.length;
  next.lastMessage = messages.at(-1);
  MESSAGE_TOTALS_CACHE.set(key, next);
  return next;
}

function breakdownOf(
  messages: readonly Message[],
  tools: readonly ToolSpec[],
  appendOnly: boolean,
): ContextBreakdown {
  const totals = messageTotals(messages, appendOnly);
  const totalInputTokens = Math.ceil(totals.totalChars / CHARS_PER_TOKEN);
  const systemTokens = Math.ceil(totals.systemChars / CHARS_PER_TOKEN);
  const toolResultTokens = Math.ceil(totals.toolResultChars / CHARS_PER_TOKEN);
  const summaryTokens = Math.ceil(totals.summaryChars / CHARS_PER_TOKEN);
  const conversationTokens = Math.max(
    0,
    totalInputTokens - systemTokens - toolResultTokens,
  );
  const toolSchemaTokens = estimateToolTokens(tools);
  return {
    systemTokens,
    conversationTokens,
    toolResultTokens,
    summaryTokens,
    toolSchemaTokens,
    totalInputTokens: totalInputTokens + toolSchemaTokens,
    cacheEligibleTokens: systemTokens + toolSchemaTokens,
    stablePrefixHash: stablePrefixHash(totals.system, tools),
  };
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function computeContextBudget(options: ContextBudgetOptions): ContextBudget {
  const contextWindow = finiteNonNegative(options.contextWindow);
  const breakdown = breakdownOf(options.messages, options.tools ?? [], options.appendOnly === true);
  if (contextWindow === undefined || contextWindow === 0) {
    return {
      contextWindow: options.contextWindow,
      reservedOutputTokens: finiteNonNegative(options.reservedOutputTokens) ?? 0,
      safetyMarginTokens: finiteNonNegative(options.safetyMarginTokens) ?? 0,
      availableInputBudget: undefined,
      effectiveInputTokens: breakdown.totalInputTokens,
      pressure: 'unknown',
      breakdown,
    };
  }

  const reservedOutputTokens = Math.min(
    Math.max(0, contextWindow - 1),
    finiteNonNegative(options.reservedOutputTokens) ?? Math.min(32_000, Math.max(256, Math.floor(contextWindow * 0.08))),
  );
  const safetyMarginTokens = Math.min(
    Math.max(0, contextWindow - reservedOutputTokens - 1),
    finiteNonNegative(options.safetyMarginTokens) ?? Math.max(128, Math.floor(contextWindow * 0.05)),
  );
  const availableInputBudget = Math.max(1, contextWindow - reservedOutputTokens - safetyMarginTokens);
  const ratio = breakdown.totalInputTokens / availableInputBudget;
  const pressure: ContextPressure = ratio >= 0.9
    ? 'critical'
    : ratio >= 0.75
      ? 'high'
      : ratio >= 0.5
        ? 'medium'
        : 'low';
  return {
    contextWindow,
    reservedOutputTokens,
    safetyMarginTokens,
    availableInputBudget,
    effectiveInputTokens: breakdown.totalInputTokens,
    pressure,
    breakdown,
  };
}

/** Stable tool order and schema key order improve cache reuse without hiding tools. */
export function stableToolSpecs(tools: readonly ToolSpec[]): ToolSpec[] {
  return [...tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: stableValue(tool.parameters) as Record<string, unknown>,
    }));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value));
}
