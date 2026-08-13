import { randomUUID } from 'node:crypto';

import type { ToolCall } from '../model/provider.js';

interface EventBase<K extends string> {
  readonly version: 1;
  readonly eventId: string;
  readonly turnId: string;
  readonly at: string;
  readonly kind: K;
}

export type ConversationEventV1 =
  | (EventBase<'turn.started'> & { readonly userEventId: string })
  | (EventBase<'turn.completed'> & { readonly durationMs: number })
  | (EventBase<'turn.interrupted'> & { readonly reason: string })
  | (EventBase<'turn.failed'> & { readonly reason: string })
  | (EventBase<'user.message'> & { readonly text: string })
  | (EventBase<'assistant.message'> & {
      readonly phase: 'commentary' | 'final';
      readonly text: string;
      readonly reasoning?: string;
      readonly toolCalls?: readonly ToolCall[];
    })
  | (EventBase<'tool.started'> & { readonly call: ToolCall })
  | (EventBase<'tool.completed'> & {
      readonly callId: string;
      readonly output: string;
      readonly ok: boolean;
      readonly durationMs: number;
      readonly diff?: string;
    })
  | (EventBase<'approval.requested'> & { readonly requestId: string; readonly text: string })
  | (EventBase<'approval.resolved'> & { readonly requestId: string; readonly decision: string })
  | (EventBase<'question.requested'> & { readonly requestId: string; readonly text: string })
  | (EventBase<'question.resolved'> & { readonly requestId: string; readonly answer: string })
  | (EventBase<'compaction.completed'> & {
      readonly summary: string;
      readonly replacedEvents: number;
    })
  | (EventBase<'history.context'> & { readonly text: string })
  | (EventBase<'notice.recorded'> & {
      readonly level: 'info' | 'warn' | 'error';
      readonly text: string;
    });

export type ConversationEvent = ConversationEventV1;

export type LegacyTranscriptEvent =
  | { readonly kind: 'user'; readonly at: string; readonly text: string }
  | { readonly kind: 'assistant'; readonly at: string; readonly text: string }
  | {
      readonly kind: 'tool';
      readonly at: string;
      readonly tool: string;
      readonly input: Record<string, unknown>;
      readonly output: string;
      readonly ok: boolean;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'note';
      readonly at: string;
      readonly text: string;
      readonly level: 'info' | 'warn' | 'error';
    }
  | {
      readonly kind: 'compaction';
      readonly at: string;
      readonly summary: string;
      readonly replacedEvents: number;
    };

export interface LegacyAdaptContext {
  readonly turnId: string;
  readonly nextEventId: () => string;
}

type EventKind = ConversationEvent['kind'];

export function eventBase<K extends EventKind>(
  kind: K,
  turnId: string,
  at = new Date().toISOString(),
): EventBase<K> {
  return { version: 1, eventId: randomUUID(), turnId, at, kind };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function baseOf(value: Record<string, unknown>): EventBase<string> | null {
  if (
    value['version'] !== 1 ||
    !isString(value['eventId']) || !value['eventId'] ||
    !isString(value['turnId']) || !value['turnId'] ||
    !isString(value['at']) || !value['at'] ||
    !isString(value['kind']) || !value['kind']
  ) {
    return null;
  }
  return {
    version: 1,
    eventId: value['eventId'],
    turnId: value['turnId'],
    at: value['at'],
    kind: value['kind'],
  };
}

function toolCallOf(value: unknown): ToolCall | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  const args = value['arguments'];
  if (!isString(id) || !id || !isString(name) || !name || !isString(args)) return null;
  return { id, name, arguments: args };
}

function toolCallsOf(value: unknown): readonly ToolCall[] | null {
  if (!Array.isArray(value)) return null;
  const calls: ToolCall[] = [];
  for (const item of value) {
    const call = toolCallOf(item);
    if (!call) return null;
    calls.push(call);
  }
  return calls;
}

/** Decode one versioned JSONL value without allowing malformed data to escape. */
export function decodeConversationEvent(value: unknown): ConversationEvent | null {
  if (!isRecord(value)) return null;
  const base = baseOf(value);
  if (!base) return null;

  switch (base.kind) {
    case 'turn.started':
      return isString(value['userEventId']) && value['userEventId']
        ? { ...base, kind: 'turn.started', userEventId: value['userEventId'] }
        : null;
    case 'turn.completed':
      return isFiniteNumber(value['durationMs']) && value['durationMs'] >= 0
        ? { ...base, kind: 'turn.completed', durationMs: value['durationMs'] }
        : null;
    case 'turn.interrupted':
      return isString(value['reason'])
        ? { ...base, kind: 'turn.interrupted', reason: value['reason'] }
        : null;
    case 'turn.failed':
      return isString(value['reason'])
        ? { ...base, kind: 'turn.failed', reason: value['reason'] }
        : null;
    case 'user.message':
      return isString(value['text'])
        ? { ...base, kind: 'user.message', text: value['text'] }
        : null;
    case 'assistant.message': {
      const phase = value['phase'];
      if ((phase !== 'commentary' && phase !== 'final') || !isString(value['text'])) return null;
      const reasoning = value['reasoning'];
      if (reasoning !== undefined && !isString(reasoning)) return null;
      const rawCalls = value['toolCalls'];
      const toolCalls = rawCalls === undefined ? undefined : toolCallsOf(rawCalls);
      if (toolCalls === null) return null;
      return {
        ...base,
        kind: 'assistant.message',
        phase,
        text: value['text'],
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(toolCalls !== undefined ? { toolCalls } : {}),
      };
    }
    case 'tool.started': {
      const call = toolCallOf(value['call']);
      return call ? { ...base, kind: 'tool.started', call } : null;
    }
    case 'tool.completed': {
      if (
        !isString(value['callId']) || !value['callId'] ||
        !isString(value['output']) ||
        typeof value['ok'] !== 'boolean' ||
        !isFiniteNumber(value['durationMs']) || value['durationMs'] < 0
      ) {
        return null;
      }
      const diff = value['diff'];
      if (diff !== undefined && !isString(diff)) return null;
      return {
        ...base,
        kind: 'tool.completed',
        callId: value['callId'],
        output: value['output'],
        ok: value['ok'],
        durationMs: value['durationMs'],
        ...(diff !== undefined ? { diff } : {}),
      };
    }
    case 'approval.requested':
      return isString(value['requestId']) && value['requestId'] && isString(value['text'])
        ? { ...base, kind: 'approval.requested', requestId: value['requestId'], text: value['text'] }
        : null;
    case 'approval.resolved':
      return isString(value['requestId']) && value['requestId'] && isString(value['decision'])
        ? {
            ...base,
            kind: 'approval.resolved',
            requestId: value['requestId'],
            decision: value['decision'],
          }
        : null;
    case 'question.requested':
      return isString(value['requestId']) && value['requestId'] && isString(value['text'])
        ? { ...base, kind: 'question.requested', requestId: value['requestId'], text: value['text'] }
        : null;
    case 'question.resolved':
      return isString(value['requestId']) && value['requestId'] && isString(value['answer'])
        ? {
            ...base,
            kind: 'question.resolved',
            requestId: value['requestId'],
            answer: value['answer'],
          }
        : null;
    case 'compaction.completed':
      return isString(value['summary']) && isFiniteNumber(value['replacedEvents']) && value['replacedEvents'] >= 0
        ? {
            ...base,
            kind: 'compaction.completed',
            summary: value['summary'],
            replacedEvents: value['replacedEvents'],
          }
        : null;
    case 'history.context':
      return isString(value['text'])
        ? { ...base, kind: 'history.context', text: value['text'] }
        : null;
    case 'notice.recorded': {
      const level = value['level'];
      return (level === 'info' || level === 'warn' || level === 'error') && isString(value['text'])
        ? { ...base, kind: 'notice.recorded', level, text: value['text'] }
        : null;
    }
    default:
      return null;
  }
}

function legacyBase<K extends EventKind>(
  kind: K,
  event: LegacyTranscriptEvent,
  context: LegacyAdaptContext,
): EventBase<K> {
  return {
    version: 1,
    eventId: context.nextEventId(),
    turnId: context.turnId,
    at: event.at,
    kind,
  };
}

function stringifyLegacyInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return '{…}';
  }
}

/** Validate an unversioned transcript record before adapting it. */
export function decodeLegacyTranscriptEvent(value: unknown): LegacyTranscriptEvent | null {
  if (!isRecord(value) || !isString(value['kind']) || !isString(value['at'])) return null;
  switch (value['kind']) {
    case 'user':
      return isString(value['text'])
        ? { kind: 'user', at: value['at'], text: value['text'] }
        : null;
    case 'assistant':
      return isString(value['text'])
        ? { kind: 'assistant', at: value['at'], text: value['text'] }
        : null;
    case 'tool':
      return isString(value['tool']) && isRecord(value['input']) && isString(value['output']) &&
        typeof value['ok'] === 'boolean' && isFiniteNumber(value['durationMs'])
        ? {
            kind: 'tool',
            at: value['at'],
            tool: value['tool'],
            input: value['input'],
            output: value['output'],
            ok: value['ok'],
            durationMs: value['durationMs'],
          }
        : null;
    case 'note': {
      const level = value['level'];
      return isString(value['text']) && (level === 'info' || level === 'warn' || level === 'error')
        ? { kind: 'note', at: value['at'], text: value['text'], level }
        : null;
    }
    case 'compaction':
      return isString(value['summary']) && isFiniteNumber(value['replacedEvents'])
        ? {
            kind: 'compaction',
            at: value['at'],
            summary: value['summary'],
            replacedEvents: value['replacedEvents'],
          }
        : null;
    default:
      return null;
  }
}

/** Convert one already-validated legacy transcript line without inventing protocol data. */
export function adaptLegacyTranscriptEvent(
  event: LegacyTranscriptEvent,
  context: LegacyAdaptContext,
): ConversationEvent | null {
  switch (event.kind) {
    case 'user':
      return { ...legacyBase('user.message', event, context), text: event.text };
    case 'assistant':
      return {
        ...legacyBase('assistant.message', event, context),
        phase: 'final',
        text: event.text,
      };
    case 'tool':
      return {
        ...legacyBase('history.context', event, context),
        text: [
          '[historical tool activity]',
          `${event.tool}(${stringifyLegacyInput(event.input)}) → ${event.ok ? 'ok' : 'failed'}`,
          event.output,
        ].filter(Boolean).join('\n'),
      };
    case 'note':
      return {
        ...legacyBase('notice.recorded', event, context),
        level: event.level,
        text: event.text,
      };
    case 'compaction':
      return {
        ...legacyBase('compaction.completed', event, context),
        summary: event.summary,
        replacedEvents: event.replacedEvents,
      };
  }
}

export function dedupeConversationEvents(
  events: readonly ConversationEvent[],
): ConversationEvent[] {
  const seen = new Set<string>();
  const unique: ConversationEvent[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    unique.push(event);
  }
  return unique;
}

const TERMINAL_TURN_KINDS = new Set<ConversationEvent['kind']>([
  'turn.completed',
  'turn.interrupted',
  'turn.failed',
]);

/** Mark turns left open by a previous process as interrupted, idempotently. */
export function recoverInterruptedTurns(
  events: readonly ConversationEvent[],
  at = new Date().toISOString(),
): ConversationEvent[] {
  const unique = dedupeConversationEvents(events);
  const started: string[] = [];
  const ended = new Set<string>();
  for (const event of unique) {
    if (event.kind === 'turn.started' && !started.includes(event.turnId)) started.push(event.turnId);
    if (TERMINAL_TURN_KINDS.has(event.kind)) ended.add(event.turnId);
  }

  const recovered = [...unique];
  for (const turnId of started) {
    if (ended.has(turnId)) continue;
    recovered.push({
      version: 1,
      eventId: `recovered-interruption:${turnId}`,
      turnId,
      at,
      kind: 'turn.interrupted',
      reason: 'previous process ended before the turn completed',
    });
  }
  return recovered;
}
