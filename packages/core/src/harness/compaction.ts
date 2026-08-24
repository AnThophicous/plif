import type { Message, ModelProvider } from '../model/provider.js';
import { collect } from '../model/provider.js';
import { compactionSystemPrompt } from '../agenting/compaction.js';
import { PlifError } from '../errors.js';
import { estimateTokens } from './context-budget.js';

export { estimateTokens } from './context-budget.js';

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
  /** False when the pass was needed but could not reduce the input. */
  readonly progressed: boolean;
  /** A provider or capsule-validation failure and the safe fallback used, if any. */
  readonly failure: CompactionFailure | null;
}

export interface CompactionFailure {
  readonly stage: string;
  readonly message: string;
  readonly attempts: number;
  readonly backoffMs: number;
  readonly fallback: 'mechanical protocol-group trimming' | 'raw history preserved';
}

const DEFAULT_KEEP_RECENT = 6;
const TOOL_OUTPUT_CEILING = 2_000;
const DEFAULT_RECENT_TOKENS = 200_000;
const DEFAULT_CHUNK_TOKENS = 100_000;
const MAX_CAPSULE_ANCHORS = 32;
const MAX_CAPSULE_ANCHOR_BYTES = 16_000;
const MAX_ATTACHMENT_TRANSCRIPT_CHARS = 16_000;
const COMPACTION_PROVIDER_ATTEMPTS = 2;
const COMPACTION_PROVIDER_BACKOFF_MS = 100;
const COMPACTION_CONTEXT_MARGIN_RATIO = 0.1;
const COMPACTION_MIN_CONTEXT_MARGIN = 128;
const COMPACTION_INPUT_HEADROOM_RATIO = 0.75;
const COMPACTION_MIN_REQUEST_TOKENS = 1;
const REQUIRED_CAPSULE_SECTIONS = [
  'Objective and checkpoint',
  'Files and changes',
  'Commands and verification',
  'Decisions and preferences',
  'Findings and errors',
  'Pending work',
] as const;

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
  if (trimmed.length < 300) return false;

  const positions: Array<{ start: number; bodyStart: number }> = [];
  for (const section of REQUIRED_CAPSULE_SECTIONS) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...trimmed.matchAll(new RegExp(`^## ${escaped}\\s*$`, 'gmi'))];
    if (matches.length !== 1 || matches[0]!.index === undefined) return false;
    positions.push({
      start: matches[0]!.index,
      bodyStart: matches[0]!.index + matches[0]![0].length,
    });
  }
  if (positions.some((position, index) => index > 0 && position.start <= positions[index - 1]!.start)) {
    return false;
  }
  return positions.every((position, index) => {
    const end = positions[index + 1]?.start ?? trimmed.length;
    return trimmed.slice(position.bodyStart, end).trim().length >= 12;
  });
}

const SENSITIVE_NAME = /(?:api|auth|access|refresh|token|password|passwd|secret|private|credential|session|cookie|authorization|signature|signing|key)/i;
const SENSITIVE_NAME_PARTS = new Set([
  'api', 'auth', 'access', 'refresh', 'token', 'password', 'passwd', 'secret',
  'private', 'credential', 'credentials', 'session', 'cookie', 'authorization',
  'signature', 'signing', 'key',
]);

function sensitiveAssignmentName(name: string): boolean {
  const normalized = name.replace(/[-_.]/g, '').toLowerCase();
  if (!normalized || !SENSITIVE_NAME.test(name)) return false;
  const parts = name.toLowerCase().split(/[-_.]+/);
  if (parts.some((part) => SENSITIVE_NAME_PARTS.has(part))) return true;
  if (
    normalized === 'key' ||
    normalized === 'token' ||
    normalized === 'secret' ||
    normalized === 'password' ||
    normalized === 'passwd' ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'credential' ||
    normalized === 'credentials' ||
    normalized === 'session' ||
    normalized === 'signature'
  ) return true;
  return /(?:apikey|authtoken|accesstoken|refreshtoken|password|passwd|secret|privatekey|credential|session(?:id|token)?|cookie|authorization|signature|signingkey|accesskey(?:id)?|secretaccesskey|clientsecret|databaseurl|connectionstring)$/.test(normalized);
}

function redactSensitiveAssignments(source: string): string {
  return source.replace(
    /\b([a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*)(["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]\r\n]+)/gi,
    (whole, name: string, separator: string) =>
      sensitiveAssignmentName(name) ? `${name}${separator}[redacted]` : whole,
  );
}

function redactSensitiveText(source: string): string {
  return redactSensitiveAssignments(source)
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      '[redacted private key]',
    )
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(
      /([?&](?:(?:[a-z0-9]+[-_.])*(?:api[-_.]?key|auth[-_.]?token|access[-_.]?token|refresh[-_.]?token|token|password|passwd|secret(?:[-_.]?key)?|secret[-_.]?access[-_.]?key|private[-_.]?key|client[-_.]?secret|credentials?|session(?:[-_.]?id|[-_.]?token)?|aws[-_.]?secret[-_.]?access[-_.]?key|aws[-_.]?session[-_.]?token)|authorization|key|signature|sig|code|aws[-_.]?access[-_.]?key[-_.]?id|google[-_.]?access[-_.]?id|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature))=)[^&#\s]*/gi,
      '$1[redacted]',
    )
    .replace(/\b((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(
      /\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\r\n]+/gi,
      '$1[redacted]',
    )
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[redacted]')
    .replace(
      /(\b(?:[a-z0-9]+[-_.])*(?:api[-_.]?key|auth[-_.]?token|access[-_.]?token|refresh[-_.]?token|token|password|passwd|secret(?:[-_.]?key)?|private[-_.]?key|client[-_.]?secret|credentials?|session(?:[-_.]?id)?|aws[-_.]?access[-_.]?key[-_.]?id|google[-_.]?access[-_.]?id)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]\r\n]+)/gi,
      '$1[redacted]',
    )
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|(?:sk|rk)-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted]');
}

function durablePlanPaths(source: string): readonly string[] {
  const matches = source.match(
    /(?:[a-z]:)?[^\s"'`<>|()[\]]*[\\/]plans[\\/][^\s"'`<>|()[\]]+\.md/gi,
  ) ?? [];
  return [...new Set(matches)];
}

const CONTINUITY_STOP_WORDS = new Set([
  'assistant', 'chronological', 'content', 'continue', 'existing', 'history', 'message',
  'reasoning', 'result', 'system', 'transcript', 'untrusted', 'workspace', 'ferramenta',
  'resultado', 'continuar', 'mensagem', 'trabalho', 'usuário', 'usuario',
]);

function operationalAnchors(source: string): readonly string[] {
  const found: string[] = [];
  const add = (value: string): void => {
    const anchor = value.trim().replace(/[),.;:]+$/, '');
    if (
      anchor.length < 3 ||
      anchor.length > 500 ||
      /\[redacted\]/i.test(anchor) ||
      /^(.)\1+$/.test(anchor) ||
      found.includes(anchor)
    ) return;
    found.push(anchor);
  };

  for (const path of durablePlanPaths(source)) add(path);
  for (const match of source.matchAll(/https?:\/\/[^\s"'`<>()[\]]+/gi)) add(match[0]);
  for (const match of source.matchAll(/(?:[a-z]:)?(?:[\\/][^\s"'`<>|()[\],:]+){2,}/gi)) add(match[0]);
  for (const match of source.matchAll(
    /"(?:path|file|url|query|objective|command|cmd|symbol|pattern)"\s*:\s*"((?:\\.|[^"\\]){2,500})"/gi,
  )) {
    try { add(JSON.parse(`"${match[1]}"`) as string); } catch { add(match[1] ?? ''); }
  }
  for (const match of source.matchAll(/\b(?:TS\d{3,}|ERR_[A-Z0-9_]+|E[A-Z][A-Z0-9_]{3,})\b/g)) add(match[0]);

  if (found.length === 0) {
    const words = [...source.matchAll(/[\p{L}][\p{L}\p{N}_.-]{6,}/gu)]
      .map((match) => match[0])
      .filter((word) => !CONTINUITY_STOP_WORDS.has(word.toLowerCase()) && !/^(.)\1+$/.test(word))
      .sort((left, right) => right.length - left.length);
    for (const word of words) add(word);
  }
  if (found.length === 0) add(`continuity-chunk-${fingerprint(source)}`);
  return found;
}

function fingerprint(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function semanticStateAnchors(source: string): readonly string[] {
  const latest = new Map<string, string>();
  const labels =
    '(?:objective|goal|current phase|phase|current checkpoint|checkpoint|' +
    'acceptance criteria|next action|exact next action|pending work|source ledger|' +
    'claim(?:-to-source| to source) ledger|subagent status|delegation status|' +
    'validation(?: status)?|test status|findings?|failures?|errors?)';
  const stateLine = new RegExp(`^\\s*(?:system|user|assistant|tool)(?: \\[[^\\]]+\\])?:\\s*`, 'i');
  const labelled = new RegExp(`^\\s*(?:[-*]\\s*)?(?:#{1,6}\\s*)?(${labels})\\s*[:=—-]\\s*(.{2,500})$`, 'i');

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(stateLine, '').trim();
    const match = labelled.exec(line);
    if (!match) continue;
    const label = match[1]!.replace(/\s+/g, ' ').trim();
    const value = match[2]!.replace(/\s+/g, ' ').trim();
    if (/\[redacted\]/i.test(value)) continue;
    latest.set(label.toLowerCase(), `${label}: ${value}`);
  }

  const unchecked = [...source.matchAll(/^\s*-\s*\[\s\]\s+(.{3,500})$/gmi)]
    .map((match) => `Unchecked checkpoint: ${match[1]!.replace(/\s+/g, ' ').trim()}`)
    .slice(-5);
  return [...latest.values(), ...unchecked];
}

function requiredCapsuleAnchors(previous: string | null, transcript: string): readonly string[] {
  const plans = durablePlanPaths(`${previous ?? ''}\n${transcript}`);
  const semantic = semanticStateAnchors(`${previous ?? ''}\n${transcript}`);
  const prior = previous ? operationalAnchors(previous).filter((anchor) => !plans.includes(anchor)).slice(-2) : [];
  const current = operationalAnchors(transcript).filter((anchor) => !plans.includes(anchor)).slice(-3);
  return [...new Set([...plans, ...semantic, ...prior, ...current])];
}

interface BoundedAnchors {
  readonly values: readonly string[];
  readonly omitted: number;
  readonly omittedHash: string | null;
}

function anchorPriority(anchor: string): number {
  if (/[\\/]plans[\\/][^\\/]+\.md$/i.test(anchor)) return 100;
  if (/^(?:Objective|Goal|Current phase|Phase|Current checkpoint|Checkpoint|Acceptance criteria|Next action|Exact next action|Pending work|Source ledger|Claim(?:-to-source| to source) ledger|Subagent status|Delegation status|Validation(?: status)?|Test status|Finding|Findings|Failure|Failures|Error|Errors|Unchecked checkpoint):/i.test(anchor)) return 90;
  if (/^https?:\/\//i.test(anchor)) return 80;
  if (/^(?:TS\d{3,}|ERR_[A-Z0-9_]+|E[A-Z][A-Z0-9_]{3,})$/.test(anchor)) return 75;
  return 50;
}

function boundedAnchors(anchors: readonly string[]): BoundedAnchors {
  const unique = [...new Set(anchors)];
  const ordered = unique
    .map((value, index) => ({ value, index, priority: anchorPriority(value) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const values: string[] = [];
  const encoder = new TextEncoder();
  for (const candidate of ordered) {
    if (values.length >= MAX_CAPSULE_ANCHORS) break;
    const proposed = [...values, candidate.value].map((value) => `- ${value}`).join('\n\n');
    if (encoder.encode(proposed).byteLength > MAX_CAPSULE_ANCHOR_BYTES) break;
    values.push(candidate.value);
  }
  const selected = new Set(values);
  const omittedValues = ordered
    .map((candidate) => candidate.value)
    .filter((value) => !selected.has(value));
  return {
    values,
    omitted: omittedValues.length,
    omittedHash: omittedValues.length > 0 ? fingerprint(omittedValues.join('\n')) : null,
  };
}

function capsulePreservesAnchors(required: readonly string[], capsule: string): boolean {
  const lines = new Set(
    capsule
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return required.every((anchor) => lines.has(anchor) || lines.has(`- ${anchor}`));
}

function boundedAttachmentText(source: string): string {
  const redacted = redactSensitiveText(source);
  if (redacted.length <= MAX_ATTACHMENT_TRANSCRIPT_CHARS) return redacted;
  const kept = Math.floor(MAX_ATTACHMENT_TRANSCRIPT_CHARS / 2);
  const omitted = redacted.slice(kept, -kept);
  return [
    redacted.slice(0, kept),
    `[${omitted.length} attachment characters omitted; hash=${fingerprint(omitted)}]`,
    redacted.slice(-kept),
  ].join('\n');
}

function transcriptOf(messages: readonly Message[]): string {
  const transcript = messages.map((message) => {
    const calls = (message.toolCalls ?? []).map((call) =>
      `${call.name}(${call.arguments}) [id=${call.id}]`,
    );
    const attachments = (message.attachments ?? []).map((attachment) => {
      if (attachment.kind === 'text') {
        return `\n  attachment ${redactSensitiveText(attachment.name)}:\n${boundedAttachmentText(attachment.text)}`;
      }
      const name = redactSensitiveText(attachment.name).replace(/[\r\n]+/g, ' ').trim();
      const mediaType = redactSensitiveText(attachment.mediaType).replace(/[\r\n]+/g, ' ').trim();
      return `\n  image attachment ${name || '[unnamed]'} (${mediaType || 'unknown media type'}; ${attachment.data.length} base64 characters; binary payload omitted)`;
    }).join('');
    return `${message.role}${message.toolCallId ? ` [result=${message.toolCallId}]` : ''}: ` +
      `${message.content}${message.reasoning ? `\n  reasoning: ${message.reasoning}` : ''}` +
      `${calls.length ? `\n  tools: ${calls.join(', ')}` : ''}${attachments}`;
  }).join('\n');
  return redactSensitiveText(transcript);
}

function errorMessage(error: unknown): string {
  const detail = PlifError.is(error)
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
  return redactSensitiveText(detail).slice(0, 1_000);
}

interface CapsuleRequestBudget {
  readonly chunkTokenBudget: number;
  readonly maxTokens: number;
  readonly contextWindow: number | undefined;
  readonly marginTokens: number;
}

function capsuleRequestBudget(
  provider: ModelProvider,
  target: number,
  requestedChunkTokenBudget: number,
  systemPrompt: string,
): CapsuleRequestBudget {
  const requestedOutputTokens = Math.min(20_000, Math.max(2_000, Math.floor(target / 10)));
  const contextWindow = provider.info.contextWindow;
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return {
      chunkTokenBudget: requestedChunkTokenBudget,
      maxTokens: requestedOutputTokens,
      contextWindow: undefined,
      marginTokens: 0,
    };
  }

  const marginTokens = Math.max(
    COMPACTION_MIN_CONTEXT_MARGIN,
    Math.floor(contextWindow * COMPACTION_CONTEXT_MARGIN_RATIO),
  );
  const systemTokens = estimateTokens([{ role: 'system', content: systemPrompt }]);
  const available = Math.max(
    COMPACTION_MIN_REQUEST_TOKENS,
    Math.floor(contextWindow) - marginTokens - systemTokens,
  );
  const maxTokens = Math.max(
    COMPACTION_MIN_REQUEST_TOKENS,
    Math.min(requestedOutputTokens, Math.floor(available * 0.25)),
  );
  const transcriptBudget = Math.max(
    COMPACTION_MIN_REQUEST_TOKENS,
    Math.floor((available - maxTokens) * COMPACTION_INPUT_HEADROOM_RATIO),
  );
  return {
    chunkTokenBudget: Math.max(
      COMPACTION_MIN_REQUEST_TOKENS,
      Math.min(requestedChunkTokenBudget, transcriptBudget),
    ),
    maxTokens,
    contextWindow: Math.floor(contextWindow),
    marginTokens,
  };
}

function mechanicalFallback(
  messages: readonly Message[],
  pinned: ReadonlySet<number>,
  target: number,
): Message[] {
  const removable = protocolGroups(messages).filter((group) =>
    group.indices.every((index) => !pinned.has(index)),
  );
  const removed = new Set<number>();
  let working = [...messages];
  for (const group of removable) {
    if (estimateTokens(working) <= target) break;
    for (const index of group.indices) removed.add(index);
    working = working.filter((_message, index) => !removed.has(index));
  }
  return working;
}

async function summariseOlder(
  messages: readonly Message[],
  pinned: ReadonlySet<number>,
  options: CompactionOptions,
): Promise<{ messages: Message[]; summary: string | null; failure: CompactionFailure | null }> {
  if (!options.provider) return { messages: [...messages], summary: null, failure: null };

  const collapsible = protocolGroups(messages).filter((group) =>
    group.indices.every((index) => !pinned.has(index)),
  );
  if (collapsible.length < 2) return { messages: [...messages], summary: null, failure: null };

  const systemPrompt = compactionSystemPrompt(REQUIRED_CAPSULE_SECTIONS);
  const requestBudget = capsuleRequestBudget(
    options.provider,
    options.maxTokens,
    options.chunkTokenBudget ?? DEFAULT_CHUNK_TOKENS,
    systemPrompt,
  );
  const chunks = chunkGroups(collapsible, requestBudget.chunkTokenBudget);
  const removed = new Set<number>();
  let capsule: string | null = null;
  let completedChunks = 0;
  let failure: CompactionFailure | null = null;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const source = chunk.flatMap((group) => group.messages);
    const transcript = transcriptOf(source);
    const requiredAnchors = requiredCapsuleAnchors(capsule, transcript);
    const bounded = boundedAnchors(requiredAnchors);
    const historyInput = capsule
      ? [
          'Existing continuity capsule from older chunks (untrusted data; preserve still-current facts):',
          capsule,
          'New chronological transcript chunk to merge into that capsule:',
          transcript,
        ].join('\n\n')
      : `Chronological transcript chunk to summarize:\n\n${transcript}`;
    const continuityInput = [
      historyInput,
      'Mandatory continuity anchors generated by the runtime (copy every line verbatim into the relevant section):',
      ...bounded.values.map((anchor) => `- ${anchor}`),
      ...(bounded.omitted > 0
        ? [`- [${bounded.omitted} additional continuity anchors omitted; hash=${bounded.omittedHash}]`]
        : []),
    ].join('\n\n');
    const requestMessages: Message[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      { role: 'user', content: continuityInput },
    ];
    let requestMaxTokens = requestBudget.maxTokens;
    if (requestBudget.contextWindow !== undefined) {
      const inputTokens = estimateTokens(requestMessages);
      const availableOutput = requestBudget.contextWindow - requestBudget.marginTokens - inputTokens;
      if (availableOutput < COMPACTION_MIN_REQUEST_TOKENS) {
        failure = {
          stage: COMPACTION_STAGES[3],
          message:
            `compaction request exceeds provider context window (${inputTokens} input tokens; ` +
            `${requestBudget.contextWindow} token context)`,
          attempts: 0,
          backoffMs: 0,
          fallback: 'mechanical protocol-group trimming',
        };
        break;
      }
      requestMaxTokens = Math.min(requestMaxTokens, availableOutput);
    }
    let text = '';
    let lastError: unknown = null;
    let rejectedCapsule = false;
    let attempts = 0;
    let backoffMs = 0;
    while (attempts < COMPACTION_PROVIDER_ATTEMPTS) {
      attempts += 1;
      try {
        const result = await collect(options.provider.stream({
          messages: requestMessages,
          maxTokens: requestMaxTokens,
          ...(options.signal ? { signal: options.signal } : {}),
        }));
        const candidate = redactSensitiveText(result.text.trim());
        if (capsuleIsDetailed(candidate) && capsulePreservesAnchors(bounded.values, candidate)) {
          text = candidate;
          lastError = null;
          break;
        }
        // A syntactically valid response that drops continuity is not a
        // transport outage. Retrying the same model tends to produce the same
        // lossy capsule, and mechanically deleting the source would turn a
        // validation failure into data loss. Preserve this chunk verbatim and
        // let the loop disable model compaction for the rest of the turn.
        rejectedCapsule = true;
        lastError = null;
        break;
      } catch (error) {
        if (options.signal?.aborted) {
          const reason = options.signal.reason;
          if (reason instanceof Error) throw reason;
          throw new Error(reason === undefined ? 'Compaction was aborted.' : String(reason));
        }
        lastError = error;
      }
      if (attempts >= COMPACTION_PROVIDER_ATTEMPTS) break;
      backoffMs += COMPACTION_PROVIDER_BACKOFF_MS;
      await new Promise<void>((resolve) => setTimeout(resolve, COMPACTION_PROVIDER_BACKOFF_MS));
    }
    if (rejectedCapsule) {
      failure = {
        stage: COMPACTION_STAGES[3],
        message: 'provider returned an incomplete continuity capsule',
        attempts,
        backoffMs,
        fallback: 'raw history preserved',
      };
      break;
    }
    if (lastError !== null) {
      failure = {
        stage: COMPACTION_STAGES[3],
        message: errorMessage(lastError),
        attempts,
        backoffMs,
        fallback: 'mechanical protocol-group trimming',
      };
      break;
    }

    // A rolling capsule makes every accepted chunk carry the state established
    // by older chunks. Stop at the first weak merge so unsummarised history
    // remains raw and chronological rather than silently losing continuity.
    if (!capsuleIsDetailed(text) || !capsulePreservesAnchors(bounded.values, text)) break;
    const indices = chunk.flatMap((group) => group.indices);
    for (const index of indices) removed.add(index);
    capsule = text;
    completedChunks = chunkIndex + 1;
  }

  if (failure?.fallback === 'raw history preserved') {
    return { messages: [...messages], summary: null, failure };
  }
  if (!capsule || removed.size === 0) return { messages: [...messages], summary: null, failure };
  const first = Math.min(...removed);
  const replacement: Message = {
    role: 'user',
    content: `[continuity capsule 1/1; merged ${completedChunks}/${chunks.length} chunks]\n${capsule}`,
  };
  const kept: Message[] = [];
  for (const [index, message] of messages.entries()) {
    if (index === first) kept.push(replacement);
    if (!removed.has(index)) kept.push(message);
  }
  return { messages: kept, summary: capsule, failure };
}

export async function compact(
  messages: readonly Message[],
  options: CompactionOptions,
): Promise<CompactionResult> {
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const before = estimateTokens(messages);
  const stages: string[] = [];

  if (before <= options.maxTokens) {
    return {
      messages: [...messages],
      before,
      after: before,
      summary: null,
      stages,
      failure: null,
      progressed: true,
    };
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
  let failure: CompactionFailure | null = null;
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
    if (collapsed.failure) {
      failure = collapsed.failure;
      if (collapsed.failure.fallback === 'mechanical protocol-group trimming') {
        const fallbackPinned = pinnedIndices(working, keepRecent);
        if (options.keepRecent === undefined) {
          const recentBudget = Math.min(
            DEFAULT_RECENT_TOKENS,
            options.recentTokenBudget ?? Math.max(1, Math.floor(options.maxTokens * 0.4)),
          );
          for (const index of recentIndicesByTokens(working, recentBudget)) fallbackPinned.add(index);
        }
        for (const [index, message] of working.entries()) {
          if (message.content.startsWith('[continuity capsule ')) fallbackPinned.add(index);
        }
        const beforeFallback = estimateTokens(working);
        working = mechanicalFallback(working, fallbackPinned, options.maxTokens);
        if (estimateTokens(working) < beforeFallback) {
          stages.push('mechanically trimmed after capsule provider failure');
        }
      }
    }
  }

  const after = estimateTokens(working);
  const progressed = after < before;
  const finalFailure = !progressed && before > options.maxTokens
    ? failure ?? {
        stage: 'compaction progress',
        message: `compaction made no progress (${before} tokens remained ${after})`,
        attempts: 0,
        backoffMs: 0,
        fallback: 'raw history preserved' as const,
      }
    : failure;
  return { messages: working, before, after, summary, stages, failure: finalFailure, progressed };
}
