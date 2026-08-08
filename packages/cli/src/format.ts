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
 * A PlifError carries a code and usually a hint, and both are worth showing: the
 * code is what a user searches for, and the hint is the next thing to do. A
 * foreign error gets its message and nothing invented on top.
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
      title: `${error.message}  (${error.code})`,
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
export function splitPaste(chunk: string): { text: string; submitted: boolean } {
  const newlineAt = chunk.search(/[\r\n]/);
  const head = newlineAt === -1 ? chunk : chunk.slice(0, newlineAt);
  // Strip C0 control bytes and DEL: they render as garbage, and an escape
  // sequence pasted into the buffer could repaint the screen when echoed.
  const text = head.replace(/[\u0000-\u001f\u007f]/g, '');
  return { text, submitted: newlineAt !== -1 };
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
  readonly target?: string;
  readonly summary?: string;
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  run_command: 'Bash',
  read_file: 'Read',
  write_file: 'Write',
  // "Update", not "Edit". The row shows a diff, and a diff is a statement about
  // what the file became — the verb should match what is underneath it.
  edit_file: 'Update',
  list_dir: 'List',
  ask_user: 'Ask',
  remember: 'Remember',
  skill: 'Skill',
  subagent: 'Subagent',
  web_search: 'Search',
  web_fetch: 'Fetch',
};

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
      target: server,
      summary: 'via MCP, outside the sandbox',
    };
  }

  const label = TOOL_LABELS[name] ?? name;

  if (name === 'run_command' && Array.isArray(record['argv'])) {
    return { label, target: (record['argv'] as string[]).join(' ') };
  }
  // Title before path: a subagent call carries both a title and a long task
  // body, and the title is the one line that says what it is doing.
  if (typeof record['query'] === 'string') {
    return { label, target: record['query'] };
  }
  if (typeof record['url'] === 'string') {
    return { label, target: record['url'] };
  }
  if (typeof record['title'] === 'string') {
    return { label, target: record['title'] };
  }
  if (typeof record['path'] === 'string') {
    return { label, target: record['path'] };
  }
  if (typeof record['question'] === 'string') {
    return { label, target: record['question'] };
  }
  if (typeof record['name'] === 'string') {
    return { label, target: record['name'] };
  }
  if (typeof record['text'] === 'string') {
    return { label, target: truncateValue(record['text']) };
  }
  return { label };
}

export { PlifError };
