import type { Message, ModelProvider } from '../model/provider.js';
import { collect } from '../model/provider.js';

export interface CompactionOptions {
  readonly maxTokens: number;
  readonly keepRecent?: number;
  readonly provider?: ModelProvider;
  readonly signal?: AbortSignal;
  /**
   * Called before each stage runs.
   *
   * `step` is the stage's fixed position in `COMPACTION_STAGES`, not a running
   * count, so a pass that skips straight to summarising still reports 4/4 and a
   * progress bar means the same thing on every pass.
   */
  readonly onStage?: (stage: string, step: number, steps: number) => void;
}

/**
 * The ladder, cheapest first.
 *
 * Each rung is tried only if the one before it left the transcript still too
 * big, so the expensive stage — a model call over the whole history — is only
 * reached when mechanical trimming was not enough.
 */
export const COMPACTION_STAGES = [
  'dropping superseded reads',
  'trimming tool output',
  'dropping stale reasoning',
  'summarising older turns',
] as const;

export interface CompactionResult {
  readonly messages: Message[];
  readonly before: number;
  readonly after: number;
  readonly summary: string | null;
  readonly stages: readonly string[];
}

const CHARS_PER_TOKEN = 4;
/** What one attached image costs, roughly, across the endpoints that take them. */
const IMAGE_TOKENS = 1_000;
const DEFAULT_KEEP_RECENT = 6;
const TOOL_OUTPUT_CEILING = 2_000;

export function estimateTokens(messages: readonly Message[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content.length;
    chars += message.reasoning?.length ?? 0;
    for (const call of message.toolCalls ?? []) {
      chars += call.name.length + call.arguments.length;
    }
    // An image is not free and is not text. Endpoints bill it as a few hundred
    // to a couple of thousand tokens depending on resolution; counting its
    // base64 length instead would read a 2MB screenshot as half a million
    // tokens and send the gauge to full on the first paste.
    for (const attachment of message.attachments ?? []) {
      void attachment;
      chars += IMAGE_TOKENS * CHARS_PER_TOKEN;
    }
    chars += 16;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function pinnedIndices(messages: readonly Message[], keepRecent: number): Set<number> {
  const pinned = new Set<number>();

  for (const [index, message] of messages.entries()) {
    if (message.role === 'system') pinned.add(index);
  }

  const firstUser = messages.findIndex((message) => message.role === 'user');
  if (firstUser >= 0) pinned.add(firstUser);

  for (let index = Math.max(0, messages.length - keepRecent); index < messages.length; index += 1) {
    pinned.add(index);
  }

  return pinned;
}

function dropSupersededReads(messages: readonly Message[], pinned: ReadonlySet<number>): Message[] {
  const latestReadOf = new Map<string, number>();

  for (const [index, message] of messages.entries()) {
    for (const call of message.toolCalls ?? []) {
      if (call.name !== 'read_file' && call.name !== 'list_dir') continue;
      try {
        const target = (JSON.parse(call.arguments) as { path?: string }).path;
        if (target) latestReadOf.set(`${call.name}:${target}`, index);
      } catch {
        continue;
      }
    }
  }

  const stale = new Set<string>();
  for (const [index, message] of messages.entries()) {
    for (const call of message.toolCalls ?? []) {
      if (call.name !== 'read_file' && call.name !== 'list_dir') continue;
      try {
        const target = (JSON.parse(call.arguments) as { path?: string }).path;
        if (!target) continue;
        if (latestReadOf.get(`${call.name}:${target}`) !== index) stale.add(call.id);
      } catch {
        continue;
      }
    }
  }

  if (stale.size === 0) return [...messages];

  return messages.map((message, index) => {
    if (pinned.has(index)) return message;
    if (message.role !== 'tool' || !message.toolCallId) return message;
    if (!stale.has(message.toolCallId)) return message;
    return { ...message, content: '[superseded by a later read of the same path]' };
  });
}

function trimToolOutputs(messages: readonly Message[], pinned: ReadonlySet<number>): Message[] {
  return messages.map((message, index) => {
    if (pinned.has(index) || message.role !== 'tool') return message;
    if (message.content.length <= TOOL_OUTPUT_CEILING) return message;

    const half = Math.floor(TOOL_OUTPUT_CEILING / 2);
    const elided = message.content.length - TOOL_OUTPUT_CEILING;
    return {
      ...message,
      content:
        message.content.slice(0, half) +
        `\n… [${elided} characters trimmed during compaction] …\n` +
        message.content.slice(-half),
    };
  });
}

function dropReasoning(messages: readonly Message[], pinned: ReadonlySet<number>): Message[] {
  return messages.map((message, index) => {
    if (pinned.has(index) || message.reasoning === undefined) return message;
    return { ...message, reasoning: '' };
  });
}

async function summariseOlder(
  messages: readonly Message[],
  pinned: ReadonlySet<number>,
  options: CompactionOptions,
): Promise<{ messages: Message[]; summary: string | null }> {
  if (!options.provider) return { messages: [...messages], summary: null };

  const collapsible = messages
    .map((message, index) => ({ message, index }))
    .filter(({ index }) => !pinned.has(index));

  if (collapsible.length < 4) return { messages: [...messages], summary: null };

  const transcript = collapsible
    .map(({ message }) => {
      const calls = (message.toolCalls ?? []).map((call) => `${call.name}(${call.arguments})`);
      return `${message.role}: ${message.content}${calls.length ? `\n  tools: ${calls.join(', ')}` : ''}`;
    })
    .join('\n')
    .slice(0, 24_000);

  const result = await collect(
    options.provider.stream({
      messages: [
        {
          role: 'system',
          content:
            'Summarise this partial transcript of a coding agent session. Keep every decision ' +
            'made, every file path touched, every command run and its outcome, and anything ' +
            'discovered about the project. Drop pleasantries and repeated observations. ' +
            'Write terse notes, not prose. Never invent detail that is not present.',
        },
        { role: 'user', content: transcript },
      ],
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );

  if (!result.text.trim()) return { messages: [...messages], summary: null };

  const kept: Message[] = [];
  let inserted = false;

  for (const [index, message] of messages.entries()) {
    if (pinned.has(index)) {
      kept.push(message);
      continue;
    }
    if (!inserted) {
      kept.push({ role: 'user', content: `[earlier turns, summarised]\n${result.text.trim()}` });
      inserted = true;
    }
  }

  return { messages: kept, summary: result.text.trim() };
}

export async function compact(
  messages: readonly Message[],
  options: CompactionOptions,
): Promise<CompactionResult> {
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const before = estimateTokens(messages);
  const stages: string[] = [];

  if (before <= options.maxTokens) {
    return { messages: [...messages], before, after: before, summary: null, stages };
  }

  const steps = COMPACTION_STAGES.length;
  const announce = (step: number): void =>
    options.onStage?.(COMPACTION_STAGES[step - 1] as string, step, steps);

  const pinned = pinnedIndices(messages, keepRecent);
  announce(1);
  let working = dropSupersededReads(messages, pinned);
  stages.push('dropped superseded reads');

  if (estimateTokens(working) > options.maxTokens) {
    announce(2);
    working = trimToolOutputs(working, pinned);
    stages.push('trimmed tool output');
  }

  if (estimateTokens(working) > options.maxTokens) {
    announce(3);
    working = dropReasoning(working, pinned);
    stages.push('dropped stale reasoning');
  }

  let summary: string | null = null;
  if (estimateTokens(working) > options.maxTokens) {
    announce(4);
    const collapsed = await summariseOlder(working, pinnedIndices(working, keepRecent), options);
    if (collapsed.summary) {
      working = collapsed.messages;
      summary = collapsed.summary;
      stages.push('summarised older turns');
    }
  }

  return { messages: working, before, after: estimateTokens(working), summary, stages };
}
