import type { ModelProtocol } from './provider.js';

/** How PLIF chooses between a provider's native continuation and local replay. */
export type ConversationStateMode = 'auto' | 'native' | 'replay';

/** Native state mechanisms are provider-specific and never interchangeable. */
export type NativeConversationStateKind =
  | 'codex-thread'
  | 'responses-previous-id'
  | 'replay'
  | 'none';

/** Non-secret identity used to prevent state from crossing provider boundaries. */
export interface ConversationStateScope {
  readonly providerId: string;
  readonly model: string;
  readonly endpoint: string;
  readonly protocol?: ModelProtocol;
  /** Optional non-secret account label supplied by a provider. */
  readonly account?: string;
}

/** Persisted continuation pointer. Never put credentials in this structure. */
export interface ConversationState {
  readonly version: 1;
  readonly scope: ConversationStateScope;
  readonly mode: ConversationStateMode;
  readonly kind: NativeConversationStateKind;
  readonly threadId?: string;
  readonly previousResponseId?: string;
  readonly lastTurnId?: string;
  readonly generation: number;
  readonly updatedAt: string;
  readonly lastFallbackReason?: string;
}

/** Telemetry for a continuation attempt; values are optional when a provider cannot report them. */
export interface ConversationStateMetrics {
  readonly mode: ConversationStateMode;
  readonly kind: NativeConversationStateKind;
  readonly messageCount: number;
  readonly payloadBytes?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly latencyMs?: number;
  readonly fallbackReason?: string;
}

export function conversationScopeOf(config: {
  readonly providerId?: string;
  readonly model: string;
  readonly baseURL: string;
  readonly protocol?: ModelProtocol;
}): ConversationStateScope {
  return {
    providerId: config.providerId ?? 'unknown',
    model: config.model,
    endpoint: config.baseURL,
    ...(config.protocol ? { protocol: config.protocol } : {}),
  };
}

export function sameConversationScope(
  left: ConversationStateScope | undefined,
  right: ConversationStateScope | undefined,
): boolean {
  return left !== undefined && right !== undefined &&
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.endpoint === right.endpoint &&
    left.protocol === right.protocol &&
    left.account === right.account;
}

/** Runtime guard used when reading the sidecar; malformed state must fall back to transcript replay. */
export function isConversationState(value: unknown): value is ConversationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const scope = raw['scope'];
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
  const identity = scope as Record<string, unknown>;
  const protocol = identity['protocol'];
  const protocolValid = protocol === undefined || protocol === 'openai-chat' || protocol === 'anthropic-messages';
  const threadId = raw['threadId'];
  const previousResponseId = raw['previousResponseId'];
  const fallbackReason = raw['lastFallbackReason'];
  const threadValid = raw['kind'] !== 'codex-thread' || (typeof threadId === 'string' && threadId.length > 0);
  const responseValid = raw['kind'] !== 'responses-previous-id' || (typeof previousResponseId === 'string' && previousResponseId.length > 0);
  return raw['version'] === 1 &&
    typeof identity['providerId'] === 'string' && identity['providerId'].length > 0 &&
    typeof identity['model'] === 'string' && identity['model'].length > 0 &&
    typeof identity['endpoint'] === 'string' && identity['endpoint'].length > 0 &&
    protocolValid &&
    (identity['account'] === undefined || (typeof identity['account'] === 'string' && identity['account'].length > 0)) &&
    (raw['mode'] === 'auto' || raw['mode'] === 'native' || raw['mode'] === 'replay') &&
    (raw['kind'] === 'codex-thread' || raw['kind'] === 'responses-previous-id' || raw['kind'] === 'replay' || raw['kind'] === 'none') &&
    typeof raw['generation'] === 'number' && Number.isInteger(raw['generation']) && raw['generation'] >= 0 &&
    typeof raw['updatedAt'] === 'string' &&
    (threadId === undefined || (typeof threadId === 'string' && threadId.length > 0)) &&
    (previousResponseId === undefined || (typeof previousResponseId === 'string' && previousResponseId.length > 0)) &&
    (raw['lastTurnId'] === undefined || (typeof raw['lastTurnId'] === 'string' && raw['lastTurnId'].length > 0)) &&
    (fallbackReason === undefined || (typeof fallbackReason === 'string' && fallbackReason.length > 0)) &&
    threadValid && responseValid;
}
