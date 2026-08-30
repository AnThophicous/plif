import type { Message } from '../model/provider.js';
import {
  adaptLegacyTranscriptEvent,
  decodeConversationEvent,
  decodeLegacyTranscriptEvent,
  dedupeConversationEvents,
} from './events.js';
import type { ConversationEvent } from './events.js';
import type { TranscriptEvent } from './store.js';

const DEFAULT_TOOL_OUTPUT_LIMIT = 2_000;

export interface ResumeOptions {
  readonly toolOutputLimit?: number;
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [${text.length - limit} characters elided]`;
}

function canonicalEvents(events: readonly TranscriptEvent[]): ConversationEvent[] {
  const canonical: ConversationEvent[] = [];
  let legacyTurn = '';
  let turns = 0;
  let eventNumber = 0;

  for (const value of events) {
    const current = decodeConversationEvent(value);
    if (current) {
      legacyTurn = current.turnId;
      canonical.push(current);
      continue;
    }
    const legacy = decodeLegacyTranscriptEvent(value);
    if (!legacy) continue;
    if (legacy.kind === 'user' || !legacyTurn) {
      turns += 1;
      legacyTurn = `legacy-resume:${turns}`;
    }
    const adapted = adaptLegacyTranscriptEvent(legacy, {
      turnId: legacyTurn,
      nextEventId: () => `legacy-resume:event:${++eventNumber}`,
    });
    if (adapted) canonical.push(adapted);
  }

  return dedupeConversationEvents(canonical);
}

export function conversationFromTranscript(
  events: readonly TranscriptEvent[],
  options: ResumeOptions = {},
): Message[] {
  const limit = options.toolOutputLimit ?? DEFAULT_TOOL_OUTPUT_LIMIT;
  const messages: Message[] = [];
  const knownCalls = new Set<string>();

  for (const event of canonicalEvents(events)) {
    switch (event.kind) {
      case 'user.message':
        if (event.text.trim()) messages.push({ role: 'user', content: event.text });
        break;
      case 'command.input':
      case 'command.completed':
      case 'terminal.output':
      case 'queued.input':
        break;
      case 'assistant.message':
        if (event.text.trim() || event.toolCalls?.length) {
          messages.push({
            role: 'assistant',
            content: event.text,
            ...(event.reasoning ? { reasoning: event.reasoning } : {}),
            ...(event.toolCalls?.length ? { toolCalls: event.toolCalls } : {}),
          });
        }
        for (const call of event.toolCalls ?? []) knownCalls.add(call.id);
        break;
      case 'tool.completed':
        if (knownCalls.has(event.callId)) {
          messages.push({
            role: 'tool',
            content: clip(event.output, limit),
            toolCallId: event.callId,
          });
        }
        break;
      case 'history.context':
        if (event.text.trim()) {
          messages.push({ role: 'user', content: clip(event.text, limit) });
        }
        break;
      case 'compaction.completed':
        if (event.summary.trim()) {
          messages.push({
            role: 'user',
            content: `[earlier turns, summarised]\n${event.summary}`,
          });
        }
        break;
      case 'turn.started':
      case 'turn.completed':
      case 'turn.interrupted':
      case 'turn.failed':
      case 'tool.started':
      case 'approval.requested':
      case 'approval.resolved':
      case 'question.requested':
      case 'question.resolved':
      case 'notice.recorded':
        break;
    }
  }

  return messages;
}
