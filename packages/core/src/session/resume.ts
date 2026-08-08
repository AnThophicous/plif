import type { Message } from '../model/provider.js';
import type { TranscriptEvent } from './store.js';

const DEFAULT_TOOL_OUTPUT_LIMIT = 2_000;

export interface ResumeOptions {
  readonly toolOutputLimit?: number;
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [${text.length - limit} characters elided]`;
}

function describeCall(tool: string, input: Record<string, unknown>): string {
  let args: string;
  try {
    args = JSON.stringify(input ?? {});
  } catch {
    args = '{…}';
  }
  return `${tool}(${clip(args, 200)})`;
}

export function conversationFromTranscript(
  events: readonly TranscriptEvent[],
  options: ResumeOptions = {},
): Message[] {
  const limit = options.toolOutputLimit ?? DEFAULT_TOOL_OUTPUT_LIMIT;
  const messages: Message[] = [];

  const appendToAssistant = (text: string): void => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      messages[messages.length - 1] = { ...last, content: `${last.content}\n${text}`.trim() };
      return;
    }
    messages.push({ role: 'assistant', content: text });
  };

  for (const event of events) {
    switch (event.kind) {
      case 'compaction':
        messages.push({
          role: 'user',
          content: `[earlier turns, summarised]\n${event.summary}`,
        });
        break;
      case 'user':
        if (event.text.trim()) messages.push({ role: 'user', content: event.text });
        break;
      case 'assistant':
        if (event.text.trim()) messages.push({ role: 'assistant', content: event.text });
        break;
      case 'tool':
        appendToAssistant(
          `[tool] ${describeCall(event.tool, event.input)} → ${event.ok ? 'ok' : 'failed'}\n${clip(event.output, limit)}`.trim(),
        );
        break;
      case 'note':
        break;
    }
  }

  return messages;
}
