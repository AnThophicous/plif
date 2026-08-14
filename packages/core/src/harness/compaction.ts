import type { Message, ModelProvider } from '../model/provider.js';
import { collect } from '../model/provider.js';
import { compactionSystemPrompt } from '../agenting/compaction.js';

export interface CompactionOptions {
  readonly maxTokens: number;
  readonly keepRecent?: number;
  /** Recent context retained verbatim, independent of message count. */
  readonly recentTokenBudget?: number;
  /** Maximum input size of one continuity-capsule request. */
  readonly chunkTokenBudget?: number;
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
  'building continuity capsules',
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
const DEFAULT_RECENT_TOKENS = 200_000;
const DEFAULT_CHUNK_TOKENS = 100_000;
const REQUIRED_CAPSULE_SECTIONS = [
  'Objective and checkpoint',
  'Files and changes',
  'Commands and verification',
  'Decisions and preferences',
  'Findings and errors',
  'Pending work',
] as const;

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

interface MessageGroup {
  readonly indices: readonly number[];
  readonly messages: readonly Message[];
}

/** Keep an assistant tool request and all of its tool results inseparable. */
export function protocolGroups(messages: readonly Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const indices = [index];
    const members = [message];
    if (message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0) {
      const ids = new Set(message.toolCalls!.map((call) => call.id));
      while (
        index + 1 < messages.length &&
        messages[index + 1]!.role === 'tool' &&
        ids.has(messages[index + 1]!.toolCallId ?? '')
      ) {
        index += 1;
        indices.push(index);
        members.push(messages[index]!);
      }
    }
    groups.push({ indices, messages: members });
  }
  return groups;
}

function recentIndicesByTokens(messages: readonly Message[], budget: number): Set<number> {
  const groups = protocolGroups(messages);
  const selected = new Set<number>();
  let used = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    const cost = estimateTokens(group.messages);
    if (selected.size > 0 && used + cost > budget) break;
    for (const messageIndex of group.indices) selected.add(messageIndex);
    used += cost;
  }
  return selected;
}

function chunkGroups(groups: readonly MessageGroup[], budget: number): MessageGroup[][] {
  const chunks: MessageGroup[][] = [];
  let current: MessageGroup[] = [];
  let tokens = 0;
  for (const group of groups) {
    const cost = estimateTokens(group.messages);
    if (current.length > 0 && tokens + cost > budget) {
      chunks.push(current);
      current = [];
      tokens = 0;
    }
    current.push(group);
    tokens += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function capsuleIsDetailed(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 300 && REQUIRED_CAPSULE_SECTIONS.every((section) =>
    trimmed.toLowerCase().includes(section.toLowerCase()),
  );
}

function transcriptOf(messages: readonly Message[]): string {
  return messages.map((message) => {
    const calls = (message.toolCalls ?? []).map((call) =>
      `${call.name}(${call.arguments}) [id=${call.id}]`,
    );
    return `${message.role}${message.toolCallId ? ` [result=${message.toolCallId}]` : ''}: ` +
      `${message.content}${message.reasoning ? `\n  reasoning: ${message.reasoning}` : ''}` +
      `${calls.length ? `\n  tools: ${calls.join(', ')}` : ''}`;
  }).join('\n');
}

async function summariseOlder(
  messages: readonly Message[],
  pinned: ReadonlySet<number>,
  options: CompactionOptions,
): Promise<{ messages: Message[]; summary: string | null }> {
  if (!options.provider) return { messages: [...messages], summary: null };

  const collapsible = protocolGroups(messages).filter((group) =>
    group.indices.every((index) => !pinned.has(index)),
  );
  if (collapsible.length < 2) return { messages: [...messages], summary: null };

  const chunks = chunkGroups(collapsible, options.chunkTokenBudget ?? DEFAULT_CHUNK_TOKENS);
  const replacements = new Map<number, Message>();
  const removed = new Set<number>();
  const summaries: string[] = [];

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const source = chunk.flatMap((group) => group.messages);
    let text = '';
    try {
      const result = await collect(options.provider.stream({
        messages: [
          {
            role: 'system',
            content: compactionSystemPrompt(REQUIRED_CAPSULE_SECTIONS),
          },
          { role: 'user', content: transcriptOf(source) },
        ],
        maxTokens: Math.min(20_000, Math.max(2_000, Math.floor(options.maxTokens / 10))),
        ...(options.signal ? { signal: options.signal } : {}),
      }));
      text = result.text.trim();
    } catch {
      text = '';
    }

    // Failure is non-destructive: leave this entire protocol-safe chunk raw.
    if (!capsuleIsDetailed(text)) continue;
    const indices = chunk.flatMap((group) => group.indices);
    const first = indices[0]!;
    replacements.set(first, {
      role: 'user',
      content: `[continuity capsule ${chunkIndex + 1}/${chunks.length}]\n${text}`,
    });
    for (const index of indices) removed.add(index);
    summaries.push(text);
  }

  if (summaries.length === 0) return { messages: [...messages], summary: null };
  const kept: Message[] = [];
  for (const [index, message] of messages.entries()) {
    const replacement = replacements.get(index);
    if (replacement) kept.push(replacement);
    if (!removed.has(index)) kept.push(message);
  }
  return { messages: kept, summary: summaries.join('\n\n') };
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
  if (options.keepRecent === undefined) {
    const recentBudget = Math.min(
      DEFAULT_RECENT_TOKENS,
      options.recentTokenBudget ?? Math.max(1, Math.floor(options.maxTokens * 0.4)),
    );
    for (const index of recentIndicesByTokens(messages, recentBudget)) pinned.add(index);
  }
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
    const summaryPinned = pinnedIndices(working, keepRecent);
    if (options.keepRecent === undefined) {
      const recentBudget = Math.min(
        DEFAULT_RECENT_TOKENS,
        options.recentTokenBudget ?? Math.max(1, Math.floor(options.maxTokens * 0.4)),
      );
      for (const index of recentIndicesByTokens(working, recentBudget)) summaryPinned.add(index);
    }
    const collapsed = await summariseOlder(working, summaryPinned, options);
    if (collapsed.summary) {
      working = collapsed.messages;
      summary = collapsed.summary;
      stages.push('summarised older turns');
    }
  }

  return { messages: working, before, after: estimateTokens(working), summary, stages };
}
