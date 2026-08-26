/**
 * Turning core data into the strings the timeline shows.
 *
 * Kept separate from both the core (which must not know about presentation) and
 * the components (which must not know about core internals). Everything here is
 * a pure function of its input, so it can be tested without a terminal.
 */

import { PlifError } from '@plif/core';
import type { CapabilitySet, ExecResult, ResourceLimits } from '@plif/core';

import { formatBytes, formatDuration, glyph } from './theme.js';

/**
 * Capabilities as a single scannable line.
 *
 * Granted and withheld are both shown, because "what can this container NOT do"
 * is the more important half and a list of only the grants makes the reader
 * infer the absences.
 */
export function formatCapabilities(capabilities: CapabilitySet): string {
  const granted: string[] = [];
  const withheld: string[] = [];
  for (const [key, value] of Object.entries(capabilities)) {
    (value ? granted : withheld).push(key);
  }
  return [
    `${glyph.done} ${granted.join(' ') || '(nothing)'}`,
    `${glyph.failed} ${withheld.join(' ') || '(nothing withheld)'}`,
  ].join('\n');
}

export function formatLimits(limits: ResourceLimits): string {
  return [
    `memory   ${formatBytes(limits.memoryBytes)}`,
    `procs    ${limits.maxProcesses}`,
    `disk     ${formatBytes(limits.diskWriteBytes)}`,
    `cpu      ${limits.cpuCores} cores`,
    `exec     ${formatDuration(limits.execTimeoutMs)} timeout`,
    `lifetime ${limits.lifetimeMs === 0 ? 'unbounded' : formatDuration(limits.lifetimeMs)}`,
  ].join('\n');
}

/**
 * The body shown under an exec entry.
 *
 * stderr is labelled rather than merged. A build that prints warnings to stderr
 * and succeeds looks identical to one that failed if the streams are flattened,
 * and that ambiguity costs real debugging time.
 */
export function formatExecOutput(result: ExecResult): string {
  const parts: string[] = [];
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
  if (result.stderr.trim()) {
    parts.push((parts.length ? '\n' : '') + 'stderr:\n' + result.stderr.trimEnd());
  }
  if (result.truncated) parts.push('\n(output truncated at the container limit)');
  if (parts.length === 0) parts.push('(no output)');
  return parts.join('\n');
}

/** The right-aligned tag on an exec row. */
export function formatExecTag(result: ExecResult): string {
  if (result.killedBy) return `[${result.killedBy}]`;
  if (result.exitCode !== 0) return `[exit ${result.exitCode}]`;
  return `[${formatDuration(result.durationMs)}]`;
}

/**
 * Render an error for the timeline.
 *
 * A PlifError carries a code and usually a hint. The hint is user-facing; the
 * generic INVALID_ARGUMENT classification is deliberately kept out of the
 * title because it adds noise to otherwise actionable command errors. Other
 * codes remain visible for diagnosis. A foreign error gets its message and
 * nothing invented on top.
 */
export function formatError(error: unknown): { title: string; detail: string | undefined } {
  if (PlifError.is(error)) {
    const lines: string[] = [];
    if (error.hint) lines.push(error.hint);
    const detail = Object.entries(error.detail).filter(([, value]) => value !== null);
    if (detail.length) {
      lines.push(
        ...detail.map(([key, value]) => `${key}: ${truncateValue(value)}`),
      );
    }
    return {
      title: error.code === 'INVALID_ARGUMENT' ? error.message : `${error.message}  (${error.code})`,
      detail: lines.length ? lines.join('\n') : undefined,
    };
  }
  if (error instanceof Error) {
    return { title: error.message, detail: undefined };
  }
  return { title: String(error), detail: undefined };
}

function truncateValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
}

/**
 * Split an input line into argv.
 *
 * Honours double quotes so a path with spaces survives, which on Windows is not
 * an edge case. Deliberately does not do shell expansion of any kind — no
 * globbing, no variable substitution, no operators. The argv that comes out of
 * here is the argv that gets executed, and there is no layer in between that
 * could reinterpret it.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Make a pasted chunk safe to insert into the prompt.
 *
 * Terminals deliver a paste as one chunk, not as N keypresses, so the input
 * handler has to cope with arbitrary text — embedded newlines, control bytes,
 * escape sequences. Inserting it raw puts a literal CR in the buffer and
 * silently corrupts the command.
 *
 * Returns the printable text plus whether the paste ended a line. A newline
 * anywhere means the user pasted something they meant to run, so the first line
 * submits. Remaining lines are dropped deliberately: the alternative is running
 * several commands the user never had a chance to read.
 */
export function sanitizePastedText(chunk: string): string {
  // Keep newlines: they are meaningful to the model and may be intentionally
  // pasted source. Other C0 bytes are never safe to echo into a terminal.
  return chunk.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
}

/** Compact, uniform UI representation of every clipboard payload. */
export function pastedContentToken(index: number, text?: string): string {
  if (text === undefined) return `[Pasted Image #${index}]`;
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.length === 0
    ? 0
    : normalized.endsWith('\n')
      ? normalized.slice(0, -1).split('\n').length
      : normalized.split('\n').length;
  const label = `${lines.toLocaleString('en-US')} ${lines === 1 ? 'line' : 'lines'}`;
  return `${glyph.subtleSparkle} Plif Pasted ${label}`;
}

/** Last-resort paste detection for terminals that ignore bracketed paste: only a chunk carrying more than one line of content is a shape the keyboard cannot produce. */
export function isTerminalPaste(chunk: string): boolean {
  return sanitizePastedText(chunk).replace(/\n+$/, '').includes('\n');
}

/** Pasted text stays readable in the input until it reaches 700 characters. */
export const PASTE_ATTACHMENT_MIN_CHARS = 700;

export function shouldAttachPastedText(text: string): boolean {
  return text.length >= PASTE_ATTACHMENT_MIN_CHARS;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|bmp|webp|avif)$/i;

function unquotePath(value: string): string {
  const trimmed = value.trim();
  const unwrapped = /^(["'])(.*)\1$/.exec(trimmed);
  const bare = unwrapped ? (unwrapped[2] ?? '') : trimmed;
  if (!/^file:\/\//i.test(bare)) return bare;
  const withoutScheme = bare.replace(/^file:\/\/\/?/i, '');
  try {
    return decodeURIComponent(withoutScheme).replace(/\//g, '\\');
  } catch {
    return withoutScheme;
  }
}

function looksLikeFilesystemPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
    || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/');
}

export function imagePathsInPaste(text: string): readonly string[] {
  const lines = text.split('\n').map(unquotePath).filter(Boolean);
  if (lines.length === 0) return [];
  const paths = lines.filter(
    (line) => looksLikeFilesystemPath(line) && IMAGE_EXTENSIONS.test(line),
  );
  return paths.length === lines.length ? paths : [];
}

/** Legacy line-oriented consumers (pickers and questions) still submit on CR. */
export function splitPaste(chunk: string): { text: string; submitted: boolean } {
  const newlineAt = chunk.search(/[\r\n]/);
  return {
    text: sanitizePastedText(newlineAt === -1 ? chunk : chunk.slice(0, newlineAt)),
    submitted: newlineAt !== -1,
  };
}

/**
 * One-line summary of a tool call's arguments, for the timeline.
 *
 * Shows the argument that identifies *what* the call acted on — a path, a
 * command — because a row reading just `read_file` tells you nothing you did
 * not already know from the glyph. Long values are clipped rather than wrapped:
 * this is a subtitle, not the content.
 */
export function summariseToolInput(input: unknown): string | undefined {
  if (typeof input === 'string') return truncateValue(input);
  if (!input || typeof input !== 'object') return undefined;

  const record = input as Record<string, unknown>;
  if (Array.isArray(record['argv'])) return truncateValue(record['argv'].join(' '));
  for (const key of ['path', 'question', 'reason']) {
    const value = record[key];
    if (typeof value === 'string') return truncateValue(value);
  }
  return undefined;
}

export interface DescribedTool {
  readonly label: string;
  readonly category: ToolCategory;
  readonly target?: string;
  readonly summary?: string;
  readonly planItems?: readonly PlanDisplayItem[];
}

export interface SearchHit {
  readonly rank: number;
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
}

/** Pull automatic diagnostics out of an edit result without repeating its summary. */
export function languageServerNote(output: string): string | null {
  const marker = 'Language server:';
  const at = output.indexOf(marker);
  return at >= 0 ? output.slice(at).trim() : null;
}

export function parseSearchResults(output: string): readonly SearchHit[] {
  const lines = output.split(/\r?\n/);
  const hits: SearchHit[] = [];
  const hasRankedSections = lines.some((line) =>
    /^##\s+Results\s*$/i.test(line) || /^Sources:\s*$/i.test(line),
  );
  let inRankedSection = !hasRankedSections;
  let inResearchQuery = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^Query\s+\d+:\s+\S/i.test(line)) {
      inResearchQuery = true;
      inRankedSection = false;
      continue;
    }
    if (/^##\s+Results\s*$/i.test(line)) {
      inRankedSection = true;
      continue;
    }
    if (/^Sources:\s*$/i.test(line)) {
      inRankedSection = inResearchQuery;
      continue;
    }
    if (
      /^##\s+(?:Related|Web results unavailable|How this is usually phrased)\s*$/i.test(line) ||
      /^##\s+/i.test(line) ||
      /^(?:Coverage:|Objective:|Purpose:|Status:|Sources:\s+none|Instant answer)/i.test(line)
    ) {
      inRankedSection = false;
      if (/^(?:Coverage:|Objective:)/i.test(line)) inResearchQuery = false;
      continue;
    }
    if (!inRankedSection) continue;

    const heading = /^(\d+)\.\s+(.+)$/.exec(line);
    if (!heading) continue;
    const rank = Number(heading[1]);
    if (!Number.isInteger(rank) || rank < 1) continue;
    const urlMatch = /^\s{2,}(https?:\/\/\S+)\s*$/i.exec(lines[index + 1] ?? '');
    if (!urlMatch) continue;
    const url = urlMatch[1]!;
    const snippetMatch = /^\s{2,}(\S.*)$/.exec(lines[index + 2] ?? '');
    const snippet = snippetMatch?.[1]?.trim() ?? '';
    hits.push({
      rank,
      title: (heading[2] ?? '').trim(),
      url,
      ...(snippet ? { snippet } : {}),
    });
    // Tool-produced URLs and snippets are indented. Their indentation is the
    // data/control boundary: "   ## Results" is snippet text, not a section.
    index += snippet ? 2 : 1;
  }
  return hits;
}

export function displayUrl(url: string, width: number): string {
  const bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  return bare.length <= width ? bare : truncateTo(bare, width);
}

function truncateTo(value: string, width: number): string {
  if (width <= 1) return value.slice(0, Math.max(0, width));
  return `${value.slice(0, width - 1)}…`;
}

export type ToolCategory =
  | 'shell'
  | 'read'
  | 'list'
  | 'search'
  | 'edit'
  | 'network'
  | 'agent'
  | 'plan'
  | 'question'
  | 'memory'
  | 'external'
  | 'tool';

export interface PlanDisplayItem {
  readonly step: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export type ToolLane = 'timeline' | 'discovery' | 'subagent';

export function toolLane(name: string): ToolLane {
  if (name === 'read_file' || name === 'list_dir') return 'discovery';
  if (name === 'subagent') return 'subagent';
  return 'timeline';
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  run_command: 'Ran',
  read_file: 'Read',
  write_file: 'Edited',
  // "Update", not "Edit". The row shows a diff, and a diff is a statement about
  // what the file became — the verb should match what is underneath it.
  edit_file: 'Edited',
  list_dir: 'List',
  ask_user: 'Ask',
  remember: 'Remember',
  skill: 'Skill',
  subagent: 'Subagent',
  web_search: 'Search',
  research: 'Research',
  web_fetch: 'Fetch',
  curl: 'Curl',
  update_plan: 'Plan updated',
  glob: 'Glob',
  grep: 'Grep',
  apply_patch: 'Update',
  diagnostics: 'Diagnostics',
  find_definition: 'Definition',
  find_references: 'References',
  outline: 'Outline',
};

export function toolCategory(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'external';
  if (name === 'run_command' || name === 'start_task') return 'shell';
  if (name === 'read_file' || name === 'diagnostics') return 'read';
  if (name === 'list_dir' || name === 'glob') return 'list';
  if (name === 'grep' || name === 'web_search' || name === 'research' || name === 'find_definition' || name === 'find_references' || name === 'outline') return 'search';
  if (name === 'web_fetch' || name === 'curl') return 'network';
  if (name === 'write_file' || name === 'edit_file' || name === 'apply_patch' || name === 'resolve_edit_conflict') return 'edit';
  if (name === 'subagent') return 'agent';
  if (name === 'update_plan') return 'plan';
  if (name === 'ask_user') return 'question';
  if (name === 'remember' || name === 'skill') return 'memory';
  return 'tool';
}

/**
 * Turn a raw tool call into the header a developer wants to read.
 *
 * `Bash(npm test)` says more at a glance than `run_command` plus a JSON blob,
 * and the name is the one they would use in conversation. MCP tools keep their
 * server prefix, because knowing a call left the sandbox matters more than a
 * tidy name.
 */
export function describeToolCall(name: string, input: unknown): DescribedTool {
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  if (name.startsWith('mcp__')) {
    const [, server, tool] = name.split('__');
    return {
      label: `${tool ?? name}`,
      category: 'external',
      target: server,
      summary: 'via MCP, outside the sandbox',
    };
  }

  const label = TOOL_LABELS[name] ?? name;
  const category = toolCategory(name);

  if (name === 'update_plan' && Array.isArray(record['plan'])) {
    const planItems = record['plan'].flatMap((value): PlanDisplayItem[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      const step = typeof item['step'] === 'string' ? item['step'].trim() : '';
      const status = item['status'];
      if (!step || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) return [];
      return [{ step, status }];
    });
    return { label, category, planItems };
  }

  if (name === 'run_command' && Array.isArray(record['argv'])) {
    return { label, category, target: (record['argv'] as string[]).join(' ') };
  }
  if (name === 'curl' && typeof record['url'] === 'string') {
    const method = typeof record['method'] === 'string' ? record['method'].toUpperCase() : 'GET';
    return { label, category, target: `${method} ${record['url']}` };
  }
  if (name === 'research' && typeof record['objective'] === 'string') {
    return { label, category, target: record['objective'] };
  }
  if (name === 'apply_patch' && Array.isArray(record['edits'])) {
    const edits = record['edits'].filter(
      (value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
    const paths = edits.flatMap((edit) => typeof edit['path'] === 'string' ? [edit['path']] : []);
    if (paths.length === 1) return { label, category, target: paths[0] };
    const count = record['edits'].length;
    return { label, category, target: `${count} ${count === 1 ? 'file' : 'files'}` };
  }
  if ((name === 'glob' || name === 'grep') && typeof record['pattern'] === 'string') {
    return { label, category, target: record['pattern'] };
  }
  // Title before path: a subagent call carries both a title and a long task
  // body, and the title is the one line that says what it is doing.
  if (typeof record['query'] === 'string') {
    return { label, category, target: record['query'] };
  }
  if (typeof record['url'] === 'string') {
    return { label, category, target: record['url'] };
  }
  if (typeof record['title'] === 'string') {
    return { label, category, target: record['title'] };
  }
  if (typeof record['path'] === 'string') {
    return { label, category, target: record['path'] };
  }
  if (typeof record['question'] === 'string') {
    return { label, category, target: record['question'] };
  }
  if (typeof record['name'] === 'string') {
    return { label, category, target: record['name'] };
  }
  if (typeof record['text'] === 'string') {
    return { label, category, target: truncateValue(record['text']) };
  }
  return { label, category };
}

export { PlifError };
