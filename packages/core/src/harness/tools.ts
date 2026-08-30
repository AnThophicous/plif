/**
 * The tools the agent can reach for.
 *
 * Every one of them goes through a `Container`, never through `node:fs` or
 * `child_process` directly. That is the whole point of the container model: the
 * path jail, the policy engine, the sandbox and the audit log are all *inside*
 * `Container`, so a tool written against it cannot accidentally bypass any of
 * them. A tool that imported `fs` would silently opt out of the entire security
 * story, which is why there is a single seam and this file is on the right side
 * of it.
 *
 * The surface stays task-shaped: structured discovery and transactional edits
 * are first-class because forcing them through a shell loses safety metadata,
 * stable output and the ability to validate the complete operation up front.
 */

import { PlifError } from '../errors.js';
import type { Container } from '../container/container.js';
import type { ExecResult } from '../types.js';
import {
  analyzeShellInvocation,
  classifyHardDeniedInvocation,
} from '../execution/shell-safety.js';
import type { ShellDialect, ShellDialectResolution } from '../execution/shell-dialects.js';
import type { ToolSpec } from '../model/provider.js';
import type { QuestionBroker, QuestionChoice } from './ask.js';
import type { MemoryStore } from './memory.js';
import type { TaskManager } from '../tasks/manager.js';
import type { EventBus } from '../events/bus.js';
import type { LspManager } from '../lsp/manager.js';
import { diagnosticsAfterWrite } from '../lsp/tools.js';
import { describeStats, diffLines, diffStats, formatDiff } from './diff.js';
import type { EditCoordinator } from './edits.js';
import {
  configSchemaText,
  formatConfigToml,
  globalConfigPath,
  isAutoApproveEnabled,
  loadGlobalConfig,
  profilesOf,
  saveGlobalConfig,
} from '../config/global.js';
import type { GlobalConfig } from '../config/global.js';
import { parseModelRef, resolveConfig, validate as validateModel } from '../model/config.js';
import type { StoredConfig } from '../model/config.js';
import type { Attachment } from '../model/provider.js';
import type { GoalController } from './goals.js';
import type { SessionStore } from '../session/store.js';
import type { ConversationEvent } from '../session/events.js';
import type { ModelExecutionContext } from '../model/provider.js';

export interface ToolContext {
  readonly container: Container;
  readonly questions: QuestionBroker;
  readonly signal: AbortSignal | undefined;
  /**
   * The parent loop's bus, for a tool that has progress worth narrating.
   *
   * Only `subagent` uses it so far, and only for a start/end pair. A tool that
   * emitted per-step events here would be putting its internals back into the
   * timeline it was called to keep out of.
   */
  readonly bus?: EventBus;
  /**
   * This call's id from the wire.
   *
   * The handle a tool needs to attach progress to its own timeline row rather
   * than opening a second one beside it.
   */
  readonly callId?: string;
  readonly memory?: MemoryStore;
  readonly readOnlyMemory?: boolean;
  readonly workspace?: string;
  /** Shared provider execution policy inherited from the parent PLIF loop. */
  readonly execution?: ModelExecutionContext;
  readonly tasks?: TaskManager;
  readonly lsp?: LspManager;
  readonly edits?: EditCoordinator;
  readonly agentId?: string;
  /** Stable session dialect; absent means shell_command is unsupported. */
  readonly shellDialect?: ShellDialect;
  readonly activateProfile?: (name: string) => Promise<void>;
  /** Set the interactive session's user-facing final objective. */
  readonly setGoal?: (condition: string) => Promise<void>;
  /** Durable goal state; model calls never arm autonomous rounds. */
  readonly goal?: GoalController;
  /** Read-only access to persisted sessions in the current workspace. */
  readonly sessions?: SessionStore;
  /** Attachments from the user message that caused this tool call. */
  readonly attachments?: readonly Attachment[];
}

export interface ToolResult {
  /** What the model sees. Keep it terse; this goes back into the context. */
  readonly output: string;
  readonly ok: boolean;
  /**
   * A unified diff of what this call changed, when it changed a file.
   *
   * A separate field rather than part of `output` because the two have
   * different audiences and different budgets: the model gets a summary it
   * cannot misread, and the interface gets structure it can colour. Folding the
   * diff into `output` would put every changed line back into the context on
   * every edit, which is the cost the summary exists to avoid.
   */
  readonly diff?: string;
  /** Full terminal-facing transcript when the model-facing output is compacted. */
  readonly display?: string;
  /** Internal accounting for composite runtime tools such as run_script. */
  readonly toolCallCount?: number;
}

export interface ToolEnvelope {
  readonly status: 'success' | 'error' | 'partial';
  readonly summary: string;
  readonly data?: string;
  readonly next?: string;
}

export function formatToolEnvelope(envelope: ToolEnvelope): string {
  return [
    `Status: ${envelope.status}`,
    `Summary: ${envelope.summary}`,
    ...(envelope.data ? ['', 'Data:', envelope.data] : []),
    ...(envelope.next ? ['', `Next: ${envelope.next}`] : []),
  ].join('\n');
}

export interface Tool {
  readonly spec: ToolSpec;
  /**
   * Safe to run at the same time as other parallel-safe calls.
   *
   * Opt-in, and it means more than "does not crash": the call must not depend
   * on, or change, anything another call in the same batch might touch. Reads
   * qualify. A write does not — two writes to one path in the same batch have
   * no defined winner. Nor does `run_command`, which can do anything at all,
   * and whose live output would be interleaved from several processes into one
   * stream with no way to tell them apart.
   */
  readonly parallelSafe?: boolean;
  /**
   * The same call with the same arguments can legitimately return something new.
   *
   * The repetition guard exists to stop a model retrying a call that failed for
   * a reason retrying cannot fix. Polling is the opposite: `task_status` on a
   * running task is *supposed* to be called again, and refusing it left the
   * model unable to watch its own background job — it asked three times, was
   * refused three times, and gave up without the output.
   */
  readonly repeatable?: boolean;
  run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

/** Truncate tool output so one `cat` of a big file cannot eat the context. */
const MAX_OUTPUT = 24_000;

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  const half = Math.floor(MAX_OUTPUT / 2);
  return (
    text.slice(0, half) +
    `\n\n… [${text.length - MAX_OUTPUT} characters elided] …\n\n` +
    text.slice(-half)
  );
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PlifError('INVALID_ARGUMENT', `tool argument "${key}" must be a non-empty string`, {
      detail: { got: value },
    });
  }
  return value;
}

export const readFile: Tool = {
  parallelSafe: true,
  spec: {
    name: 'read_file',
    description:
      'Read a UTF-8 text file from the container. Paths are container-absolute, ' +
      'e.g. /project/src/index.ts.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Container-absolute path' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const path = requireString(input, 'path');
    const content = await context.container.readFile(path);
    if (context.edits && context.agentId) await context.edits.observe(context.agentId, path, content);
    // Line numbers, because the next thing the model wants to do is refer to a
    // specific line, and making it count is a reliable source of off-by-ones.
    const lines = content.split('\n');
    // A file ending in a newline splits to a trailing empty element, which is
    // not a line — numbering it made every well-formed file report one line
    // more than it has, and invited a reference to a line that is not there.
    // Only one is dropped, so a file with no final newline keeps everything.
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const numbered = lines
      .map((line, index) => `${String(index + 1).padStart(5)}\t${line}`)
      .join('\n');
    return { output: clip(numbered), ok: true };
  },
};

export const writeFile: Tool = {
  spec: {
    name: 'write_file',
    description:
      'Write a UTF-8 text file in the container, creating parent directories. ' +
      'Replaces the whole file — read it first if you mean to edit part of it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Container-absolute path' },
        content: { type: 'string', description: 'Complete new file contents' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const path = requireString(input, 'path');
    const content = typeof input['content'] === 'string' ? input['content'] : '';
    // Read before writing, so the result can say what changed rather than only
    // that something did. A missing file diffs against empty, which is exactly
    // right: every line of a new file is an addition.
    const previous = await context.container.readFile(path).catch(() => null);
    if (context.edits && context.agentId) await context.edits.commit(context.agentId, path, content, context.container);
    else await context.container.writeFile(path, content);

    const changes = diffLines(previous ?? '', content);
    const stats = diffStats(changes);
    const lspNote = context.lsp
      ? await diagnosticsAfterWrite(
          context.lsp,
          await context.container.hostPathFor(path),
        ).catch(() => null)
      : null;

    const what =
      previous === null
        ? `created ${path} (${content.split('\n').length} lines)`
        : describeStats(stats)
          ? `updated ${path} — ${describeStats(stats)?.toLowerCase()}`
          : `${path} was already exactly this; nothing changed`;

    return {
      output: `${what}${lspNote ?? ''}`,
      ok: !lspNote || !/\berror\(s\)/.test(lspNote),
      ...(stats.added + stats.removed > 0 ? { diff: formatDiff(path, changes) } : {}),
    };
  },
};

/**
 * Change part of a file, by naming the part.
 *
 * `write_file` can do everything this does, and that is precisely the problem:
 * to change one line with it the model has to reproduce the entire file from
 * context, and what it reproduces is *its memory of the file*, not the file.
 * Every such rewrite is a chance to silently drop a function it had not looked
 * at recently. Anchoring on a quoted snippet removes the opportunity — either
 * the snippet is there and the edit is surgical, or it is not and the edit is
 * refused before anything is written.
 *
 * The uniqueness requirement is the other half. A snippet that appears three
 * times names no particular one of them, and picking the first is a coin flip
 * the model cannot see the result of.
 */
export const editFile: Tool = {
  spec: {
    name: 'edit_file',
    description:
      'Change part of an existing file by replacing an exact snippet. Prefer this over ' +
      'write_file for anything but a new file: it cannot accidentally drop the parts of ' +
      'the file you did not look at. `old_string` must appear exactly once — include ' +
      'surrounding lines to make it unique — unless replace_all is set. Returns a diff.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Container-absolute path' },
        old_string: {
          type: 'string',
          description: 'Exact text to replace, including indentation. Must be unique in the file.',
        },
        new_string: { type: 'string', description: 'What to put in its place. Empty deletes it.' },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence instead of requiring exactly one',
        },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const path = requireString(input, 'path');
    const oldString = requireString(input, 'old_string');
    const newString = typeof input['new_string'] === 'string' ? input['new_string'] : '';
    const replaceAll = input['replace_all'] === true;

    if (oldString === newString) {
      return { output: 'Error: old_string and new_string are identical; nothing to do.', ok: false };
    }

    const before = await context.container.readFile(path);
    const occurrences = countOccurrences(before, oldString);

    if (occurrences === 0) {
      // Say *why* it did not match, because "not found" sends the model
      // straight back with the same string. Whitespace is the usual culprit and
      // the one it cannot see in its own output.
      const loose = countOccurrences(
        before.replace(/[ \t]+/g, ' '),
        oldString.replace(/[ \t]+/g, ' '),
      );
      return {
        output:
          `Error: that snippet does not appear in ${path}.` +
          (loose > 0
            ? ' It matches when whitespace is collapsed, so the indentation differs — read the file and copy the exact leading spaces or tabs.'
            : ' Read the file and copy the text you mean to replace verbatim.'),
        ok: false,
      };
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        output:
          `Error: that snippet appears ${occurrences} times in ${path}, so it does not identify ` +
          'one place. Include the surrounding lines to make it unique, or set replace_all if you ' +
          'really mean every occurrence.',
        ok: false,
      };
    }

    const after = replaceAll
      ? before.split(oldString).join(newString)
      : before.replace(oldString, newString);

    if (context.edits && context.agentId) {
      // The coordinator holds the hash the agent read at, so a file changed by
      // someone else between the read and this write raises EDIT_CONFLICT
      // rather than quietly clobbering them.
      await context.edits.observe(context.agentId, path, before);
      await context.edits.commit(context.agentId, path, after, context.container);
    } else {
      await context.container.writeFile(path, after);
    }

    const changes = diffLines(before, after);
    const stats = diffStats(changes);
    const lspNote = context.lsp
      ? await diagnosticsAfterWrite(
          context.lsp,
          await context.container.hostPathFor(path),
        ).catch(() => null)
      : null;

    return {
      output:
        `edited ${path}${occurrences > 1 ? ` (${occurrences} occurrences)` : ''} — ` +
        `${describeStats(stats)?.toLowerCase() ?? 'no line changes'}${lspNote ?? ''}`,
      ok: !lspNote || !/\berror\(s\)/.test(lspNote),
      ...(stats.added + stats.removed > 0 ? { diff: formatDiff(path, changes) } : {}),
    };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export const listDir: Tool = {
  parallelSafe: true,
  spec: {
    name: 'list_dir',
    description: 'List the entries of a directory in the container.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Container-absolute directory path' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const path = requireString(input, 'path');
    const entries = (await context.container.listDir(path)).filter(
      (entry) => entry.kind !== 'directory' || !DEFAULT_IGNORED_DIRECTORIES.has(entry.name.toLowerCase()),
    );
    if (entries.length === 0) return { output: `${path} is empty`, ok: true };
    const listing = entries
      .map((entry) => (entry.kind === 'directory' ? `${entry.name}/` : entry.name))
      .sort()
      .join('\n');
    return { output: clip(listing), ok: true };
  },
};

const MAX_DISCOVERY_ENTRIES = 10_000;
const DEFAULT_SEARCH_RESULTS = 200;
const MAX_SEARCH_RESULTS = 500;
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.tmp',
  'tmp',
  'logs',
  'vendor',
  '.next',
  'out',
  'target',
]);

interface IgnoreRule {
  readonly matcher: RegExp;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
}

interface WalkedFile {
  readonly absolute: string;
  readonly relative: string;
}

async function* walkFiles(
  container: Container,
  root: string,
  requestedPatterns: readonly string[] = [],
): AsyncGenerator<WalkedFile> {
  const normalizedRoot = normalizeToolPath(root);
  const pending = [normalizedRoot];
  const rules = await loadIgnoreRules(container, normalizedRoot);
  const rootName = normalizedRoot.split('/').at(-1)?.toLowerCase() ?? '';
  const explicitlyRequestedIgnored = new Set(
    [...DEFAULT_IGNORED_DIRECTORIES].filter((name) =>
      normalizedRoot.toLowerCase() === `/${name}` ||
      requestedPatterns.some((pattern) => mentionsPathSegment(pattern, name)),
    ),
  );
  const explicitlyRequestedRoot = DEFAULT_IGNORED_DIRECTORIES.has(rootName);
  let visited = 0;

  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await container.listDir(directory);
    for (const entry of entries) {
      const absolute = joinToolPath(directory, entry.name);
      const relative = relativeToolPath(normalizedRoot, absolute);
      if (
        entry.kind === 'directory' &&
        !explicitlyRequestedRoot &&
        DEFAULT_IGNORED_DIRECTORIES.has(entry.name.toLowerCase()) &&
        !explicitlyRequestedIgnored.has(entry.name.toLowerCase())
      ) continue;
      if (isIgnored(relative, entry.kind === 'directory', rules)) continue;

      visited += 1;
      if (visited > MAX_DISCOVERY_ENTRIES) {
        throw new PlifError('INVALID_ARGUMENT', `discovery exceeded ${MAX_DISCOVERY_ENTRIES} entries`, {
          hint: 'Use a narrower source path or explicitly request an ignored directory.',
        });
      }
      if (entry.kind === 'directory') pending.push(absolute);
      else yield { absolute, relative };
    }
  }
}

function mentionsPathSegment(pattern: string, segment: string): boolean {
  const normalized = pattern.replace(/\\/g, '/').toLowerCase();
  const escaped = segment.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return new RegExp(`(?:^|/)${escaped}(?:/|$)`).test(normalized);
}

function ignoreRule(pattern: string): IgnoreRule | null {
  let value = pattern.trim();
  if (!value || value.startsWith('#')) return null;
  let negated = false;
  if (value.startsWith('!')) {
    negated = true;
    value = value.slice(1);
  }
  const directoryOnly = value.endsWith('/');
  value = value.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!value) return null;

  const hasSlash = value.includes('/');
  let source = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '*' && value[index + 1] === '*') {
      index += 1;
      if (value[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
  }
  const prefix = hasSlash ? '^' : '^(?:.*/)?';
  return { matcher: new RegExp(`${prefix}${source}$`), negated, directoryOnly };
}

async function loadIgnoreRules(container: Container, root: string): Promise<readonly IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  for (const filename of ['.gitignore', '.ignore', '.rgignore']) {
    const content = await container.readFile(joinToolPath(root, filename)).catch(() => null);
    if (content === null) continue;
    for (const line of content.split(/\r?\n/)) {
      const rule = ignoreRule(line);
      if (rule) rules.push(rule);
    }
  }
  return rules;
}

function isIgnored(relative: string, directory: boolean, rules: readonly IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !directory) continue;
    if (rule.matcher.test(relative)) ignored = !rule.negated;
  }
  return ignored;
}

function normalizeToolPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '/') return normalized;
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function joinToolPath(parent: string, child: string): string {
  return normalizeToolPath(`${parent}/${child}`);
}

function relativeToolPath(root: string, absolute: string): string {
  if (root === '/') return absolute.slice(1);
  return absolute.slice(root.length).replace(/^\//, '');
}

function resultLimit(input: Record<string, unknown>): number {
  const value = input['max_results'];
  if (value === undefined) return DEFAULT_SEARCH_RESULTS;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_SEARCH_RESULTS) {
    throw new PlifError('INVALID_ARGUMENT', `max_results must be between 1 and ${MAX_SEARCH_RESULTS}`);
  }
  return value as number;
}

function globExpression(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === '*' && normalized[index + 1] === '*') {
      index += 1;
      if (normalized[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

export const globFiles: Tool = {
  parallelSafe: true,
  spec: {
    name: 'glob',
    description: 'Find files recursively by glob pattern without starting a shell process.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Pattern relative to path, e.g. **/*.ts' },
        path: { type: 'string', description: 'Container-absolute root; defaults to /project' },
        max_results: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const pattern = requireString(input, 'pattern');
    const root = typeof input['path'] === 'string' ? input['path'] : '/project';
    const limit = resultLimit(input);
    const matcher = globExpression(pattern);
    const matches: string[] = [];
    for await (const file of walkFiles(context.container, root, [pattern])) {
      if (matcher.test(file.relative)) matches.push(file.absolute);
    }
    matches.sort();
    matches.splice(limit);
    return {
      output: clip(matches.length > 0 ? matches.join('\n') : `No files matched ${pattern} under ${root}.`),
      ok: true,
    };
  },
};

export const grepFiles: Tool = {
  parallelSafe: true,
  spec: {
    name: 'grep',
    description: 'Search text files recursively with a regular expression and return path:line matches.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression' },
        path: { type: 'string', description: 'Container-absolute root; defaults to /project' },
        include: { type: 'string', description: 'Optional file glob, e.g. **/*.ts' },
        case_sensitive: { type: 'boolean', description: 'Defaults to true' },
        max_results: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const pattern = requireString(input, 'pattern');
    const root = typeof input['path'] === 'string' ? input['path'] : '/project';
    const limit = resultLimit(input);
    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern, input['case_sensitive'] === false ? 'i' : '');
    } catch (error) {
      throw new PlifError('INVALID_ARGUMENT', `invalid regular expression: ${(error as Error).message}`);
    }
    const includePattern = typeof input['include'] === 'string' ? input['include'] : undefined;
    const include = includePattern ? globExpression(includePattern) : null;
    const matches: string[] = [];

    for await (const file of walkFiles(context.container, root, includePattern ? [includePattern] : [])) {
      if (include && !include.test(file.relative)) continue;
      const content = await context.container.readFile(file.absolute).catch(() => null);
      if (content === null || content.includes('\0')) continue;
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!matcher.test(line)) continue;
        matches.push(`${file.absolute}:${index + 1}:${line.slice(0, 500)}`);
        if (matches.length >= limit) break;
      }
      if (matches.length >= limit) break;
    }

    return {
      output: clip(matches.length > 0 ? matches.join('\n') : `No matches for ${pattern} under ${root}.`),
      ok: true,
    };
  },
};

interface PatchEdit {
  readonly path: string;
  readonly oldString: string;
  readonly newString: string;
  readonly replaceAll: boolean;
}

export const applyPatch: Tool = {
  spec: {
    name: 'apply_patch',
    description:
      'Apply one or more exact replacements as one transaction. Every edit is validated before ' +
      'the first write; if a later write fails, earlier writes are restored.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Container-absolute file path' },
              old_string: { type: 'string', description: 'Exact existing text' },
              new_string: { type: 'string', description: 'Replacement text; empty deletes' },
              replace_all: { type: 'boolean' },
            },
            required: ['path', 'old_string', 'new_string'],
            additionalProperties: false,
          },
        },
      },
      required: ['edits'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!Array.isArray(input['edits']) || input['edits'].length === 0) {
      throw new PlifError('INVALID_ARGUMENT', 'apply_patch needs a non-empty edits array');
    }

    const edits: PatchEdit[] = input['edits'].map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PlifError('INVALID_ARGUMENT', `edits[${index}] must be an object`);
      }
      const record = value as Record<string, unknown>;
      return {
        path: requireString(record, 'path'),
        oldString: requireString(record, 'old_string'),
        newString: typeof record['new_string'] === 'string' ? record['new_string'] : '',
        replaceAll: record['replace_all'] === true,
      };
    });

    if (new Set(edits.map((edit) => edit.path)).size !== edits.length) {
      throw new PlifError('INVALID_ARGUMENT', 'apply_patch accepts each path once per transaction');
    }

    const staged: { edit: PatchEdit; before: string; after: string }[] = [];
    for (const edit of edits) {
      if (edit.oldString === edit.newString) {
        throw new PlifError('INVALID_ARGUMENT', `${edit.path}: old_string and new_string are identical`);
      }
      const before = await context.container.readFile(edit.path);
      const occurrences = countOccurrences(before, edit.oldString);
      if (occurrences === 0) {
        throw new PlifError('INVALID_ARGUMENT', `${edit.path}: old_string was not found`);
      }
      if (occurrences > 1 && !edit.replaceAll) {
        throw new PlifError('INVALID_ARGUMENT', `${edit.path}: old_string appears ${occurrences} times`);
      }
      const after = edit.replaceAll
        ? before.split(edit.oldString).join(edit.newString)
        : before.replace(edit.oldString, edit.newString);
      staged.push({ edit, before, after });
    }

    const written: typeof staged = [];
    try {
      for (const item of staged) {
        if (context.edits && context.agentId) {
          await context.edits.observe(context.agentId, item.edit.path, item.before);
          await context.edits.commit(context.agentId, item.edit.path, item.after, context.container);
        } else {
          await context.container.writeFile(item.edit.path, item.after);
        }
        written.push(item);
      }
    } catch (error) {
      for (const item of written.reverse()) {
        await context.container.writeFile(item.edit.path, item.before).catch(() => undefined);
      }
      throw error;
    }

    const diffs = staged.map((item) => formatDiff(item.edit.path, diffLines(item.before, item.after)));
    const summary = staged
      .map((item) => `${item.edit.path} — ${describeStats(diffStats(diffLines(item.before, item.after)))?.toLowerCase() ?? 'updated'}`)
      .join('\n');
    const lspNotes: string[] = [];
    if (context.lsp) {
      for (const item of staged) {
        const note = await diagnosticsAfterWrite(
          context.lsp,
          await context.container.hostPathFor(item.edit.path),
        ).catch(() => null);
        if (note) lspNotes.push(`${item.edit.path}${note}`);
      }
    }
    return {
      output: `${summary}${lspNotes.length > 0 ? `\n\n${lspNotes.join('\n\n')}` : ''}`,
      diff: diffs.join('\n'),
      ok: !lspNotes.some((note) => /\berror\(s\)/.test(note)),
    };
  },
};

export const runCommand: Tool = {
  spec: {
    name: 'run_command',
    description:
      'Run a command inside the container. Pass argv as an array — there is no ' +
      'shell, so pipes, redirects and && do not work. Say why you are running it.',
    parameters: {
      type: 'object',
      properties: {
        argv: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command and arguments, e.g. ["npm", "test"]',
        },
        reason: {
          type: 'string',
          description: 'Short justification, shown to the human on an approval prompt',
        },
      },
      required: ['argv', 'reason'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const argv = input['argv'];
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
      throw new PlifError('INVALID_ARGUMENT', 'run_command needs a non-empty argv array', {
        detail: { got: argv },
        hint: 'There is no shell. Use ["npm","test"], not "npm test | tee log".',
      });
    }

    const result = await context.container.exec({
      argv: argv as string[],
      reason: typeof input['reason'] === 'string' ? input['reason'] : 'no reason given',
      ...(context.signal ? { signal: context.signal } : {}),
    });

    return formatExecToolResult(result);
  },
};

function terminalOwner(context: ToolContext): string {
  return context.agentId ?? 'primary';
}

function terminalChunksText(chunks: readonly { readonly stream: string; readonly chunk: string }[]): string {
  if (chunks.length === 0) return 'No terminal output is available yet.';
  return chunks.map((item) => item.stream + ':\n' + item.chunk).join('\n');
}

export const terminalStart: Tool = {
  spec: {
    name: 'terminal_start',
    description: 'Start a persistent interactive terminal inside the container. Use terminal_write for stdin and terminal_read for output.',
    parameters: {
      type: 'object',
      properties: {
        argv: { type: 'array', items: { type: 'string' }, description: 'Command and arguments.' },
        cwd: { type: 'string', description: 'Optional container working directory.' },
        reason: { type: 'string', description: 'Why this interactive terminal is needed.' },
      },
      required: ['argv', 'reason'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const argv = input['argv'];
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((item) => typeof item === 'string')) {
      throw new PlifError('INVALID_ARGUMENT', 'terminal_start needs a non-empty argv array');
    }
    const result = await context.container.startTerminal({
      argv: argv as string[],
      reason: typeof input['reason'] === 'string' ? input['reason'] : 'interactive terminal',
      ...(typeof input['cwd'] === 'string' ? { cwd: input['cwd'] } : {}),
      ownerId: terminalOwner(context),
      sessionId: context.agentId,
    });
    return { output: 'terminal_id: ' + result.terminalId + '\nInteractive terminal started.', ok: true };
  },
};

export const terminalWrite: Tool = {
  spec: {
    name: 'terminal_write',
    description: 'Write input to an owned persistent terminal. Include newlines when the process expects Enter.',
    parameters: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string' },
        input: { type: 'string' },
      },
      required: ['terminal_id', 'input'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const id = requireString(input, 'terminal_id');
    const value = requireString(input, 'input');
    const chunks = await context.container.writeTerminal(id, terminalOwner(context), value);
    return { output: terminalChunksText(chunks), ok: true };
  },
};

export const terminalRead: Tool = {
  spec: {
    name: 'terminal_read',
    description: 'Read output currently available from an owned persistent terminal without closing it.',
    parameters: {
      type: 'object',
      properties: { terminal_id: { type: 'string' } },
      required: ['terminal_id'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const chunks = await context.container.readTerminal(requireString(input, 'terminal_id'), terminalOwner(context));
    return { output: terminalChunksText(chunks), ok: true };
  },
};

export const terminalResize: Tool = {
  spec: {
    name: 'terminal_resize',
    description: 'Set the column and row size of an owned persistent terminal.',
    parameters: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string' },
        columns: { type: 'integer' },
        rows: { type: 'integer' },
      },
      required: ['terminal_id', 'columns', 'rows'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const columns = input['columns'];
    const rows = input['rows'];
    if (typeof columns !== 'number' || typeof rows !== 'number') {
      throw new PlifError('INVALID_ARGUMENT', 'terminal_resize needs integer columns and rows');
    }
    await context.container.resizeTerminal(requireString(input, 'terminal_id'), terminalOwner(context), columns, rows);
    return { output: 'Terminal resized.', ok: true };
  },
};

export const terminalSignal: Tool = {
  spec: {
    name: 'terminal_signal',
    description: 'Send an interrupt or termination signal to an owned persistent terminal.',
    parameters: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string' },
        signal: { type: 'string', enum: ['SIGINT', 'SIGTERM', 'SIGKILL'] },
      },
      required: ['terminal_id', 'signal'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const signal = input['signal'];
    if (signal !== 'SIGINT' && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      throw new PlifError('INVALID_ARGUMENT', 'terminal_signal needs SIGINT, SIGTERM, or SIGKILL');
    }
    await context.container.signalTerminal(requireString(input, 'terminal_id'), terminalOwner(context), signal);
    return { output: 'Terminal signal sent.', ok: true };
  },
};

export const terminalClose: Tool = {
  spec: {
    name: 'terminal_close',
    description: 'Close an owned persistent terminal and return its final exit status and output.',
    parameters: {
      type: 'object',
      properties: { terminal_id: { type: 'string' } },
      required: ['terminal_id'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const result = await context.container.closeTerminal(requireString(input, 'terminal_id'), terminalOwner(context));
    return formatExecToolResult(result);
  },
};

const MAX_SHELL_SCRIPT_BYTES = 32 * 1024;

export const shellCommand: Tool = {
  spec: {
    name: 'shell_command',
    description:
      'Run one script through the session\'s supported shell dialect. Use this for ' +
      'pipelines, redirection, shell-native commands, and multi-step expressions; ' +
      'prefer run_command for one executable.',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Literal script passed as one argv element to the selected interpreter',
        },
        reason: {
          type: 'string',
          description: 'Short justification, shown to the human on an approval prompt',
        },
      },
      required: ['script', 'reason'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const script = requireString(input, 'script');
    if (script.includes('\0')) {
      throw new PlifError('INVALID_ARGUMENT', 'shell_command scripts cannot contain NUL bytes');
    }
    const size = Buffer.byteLength(script, 'utf8');
    if (size > MAX_SHELL_SCRIPT_BYTES) {
      throw new PlifError(
        'INVALID_ARGUMENT',
        `shell_command script is ${size} bytes; the limit is ${MAX_SHELL_SCRIPT_BYTES}`,
        { detail: { size, limit: MAX_SHELL_SCRIPT_BYTES } },
      );
    }

    const dialect = context.shellDialect;
    if (!dialect) {
      throw new PlifError(
        'SHELL_UNSUPPORTED',
        'shell_command is unavailable because this run has no resolved shell dialect',
        { hint: 'Use run_command with literal argv or a dedicated file tool.' },
      );
    }

    const argv = dialect.argv(script);
    const envelope = analyzeShellInvocation(argv);
    if (envelope.state !== 'static-envelope' || envelope.script !== script) {
      throw new PlifError(
        'POLICY_DENIED',
        `the ${dialect.displayName} invocation cannot be inspected safely`,
        { detail: { state: envelope.state, reason: envelope.reason } },
      );
    }
    const dangerous = classifyHardDeniedInvocation(argv);
    if (dangerous) {
      throw new PlifError(
        'POLICY_DENIED',
        `shell_command rejected "${dangerous.command}": ${dangerous.reason}`,
        { detail: { command: dangerous.command, reason: dangerous.reason } },
      );
    }

    const result = await context.container.exec({
      argv,
      reason: typeof input['reason'] === 'string' ? input['reason'] : 'no reason given',
      ...(context.signal ? { signal: context.signal } : {}),
    });
    return formatExecToolResult(result);
  },
};

/** Keep process-result semantics identical across direct and interpreter exec. */
export function formatExecToolResult(result: ExecResult): ToolResult {
  // Both streams are labelled and the exit code is always stated. A model
  // shown only stdout cannot tell a warning-and-succeeded from a failure.
  const parts: string[] = [`exit ${result.exitCode}${result.killedBy ? ` (${result.killedBy})` : ''}`];
  if (result.stdout.trim()) parts.push(`stdout:\n${compactTerminal(result.stdout)}`);
  if (result.stderr.trim()) parts.push(`stderr:\n${compactTerminal(result.stderr)}`);
  if (result.truncated) parts.push('(output truncated at the container limit)');
  if (parts.length === 1) parts.push('(no output)');

  const ok = result.exitCode === 0 && !result.killedBy;
  return {
    output: clip(formatToolEnvelope({
      status: ok ? 'success' : 'error',
      summary: `Process exited with code ${result.exitCode}${result.killedBy ? ` (${result.killedBy})` : ''}.`,
      data: parts.join('\n'),
      next: ok
        ? 'Use this output as evidence for the current checkpoint.'
        : 'Read stderr and exit status before changing the command or hypothesis.',
    })),
    display: [
      `exit ${result.exitCode}${result.killedBy ? ` (${result.killedBy})` : ''}`,
      result.stdout.trimEnd(),
      result.stderr.trimEnd(),
      result.truncated ? '(output truncated at the container limit)' : '',
    ].filter(Boolean).join('\n'),
    ok,
  };
}

function compactTerminal(value: string): string {
  const lines = value.trimEnd().split(/\r?\n/);
  if (lines.length <= 5) return lines.join('\n');
  return [...lines.slice(0, 2), `… ${lines.length - 4} lines hidden (expand the tool row to inspect)`, ...lines.slice(-2)].join('\n');
}

export const askUser: Tool = {
  repeatable: true,
  spec: {
    name: 'ask_user',
    description:
      'Ask the human a question when you genuinely cannot decide — an ambiguous ' +
      'requirement, a missing credential, a choice with real trade-offs. Do not ' +
      'use it to ask permission for an action; that happens automatically. Do not ' +
      'use it for anything you could find out by reading a file or running a command.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question, in one sentence' },
        options: {
          type: 'array',
          maxItems: 3,
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['value', 'label'],
                additionalProperties: false,
              },
            ],
          },
          description: 'Suggested answers. Objects add the second-line description shown in the picker.',
        },
        context: {
          type: 'string',
          description: 'Why you are stuck, so the human can judge without re-reading everything',
        },
      },
      required: ['question', 'context'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const question = requireString(input, 'question');
    const questionContext = requireString(input, 'context');
    const options = Array.isArray(input['options'])
      ? (input['options'] as unknown[]).flatMap<QuestionChoice>((option) => {
          if (typeof option === 'string') return [option];
          if (!option || typeof option !== 'object') return [];
          const item = option as Record<string, unknown>;
          if (typeof item['value'] !== 'string' || typeof item['label'] !== 'string') return [];
          return [{
            value: item['value'],
            label: item['label'],
            ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
          }];
        })
      : undefined;

    if (Array.isArray(input['options']) && options?.length !== input['options'].length) {
      throw new PlifError('INVALID_ARGUMENT', 'every ask_user option needs a string value or value and label');
    }
    if ((options?.length ?? 0) > 3) {
      throw new PlifError('INVALID_ARGUMENT', 'ask_user accepts at most three options');
    }

    const answer = await context.questions.ask({
      text: question,
      ...(options?.length ? { options } : {}),
      context: questionContext,
    });

    if (answer === null) {
      // Say plainly that nobody answered. An agent told "no response" will pick
      // a default and note the assumption; an agent handed a fabricated answer
      // will proceed as if the human agreed to something they never saw.
      return {
        output: formatToolEnvelope({
          status: 'partial',
          summary: 'The human did not respond before the question timeout.',
          next: 'Choose the most defensible default, state the assumption, and continue.',
        }),
        ok: false,
      };
    }
    return {
      output: formatToolEnvelope({
        status: 'success',
        summary: 'The human answered the requested decision.',
        data: answer,
        next: 'Apply this answer only to the decision the question described.',
      }),
      ok: true,
    };
  },
};

export const listProfiles: Tool = {
  spec: { name: 'list_profiles', description: 'List persistent main-agent profiles.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  async run() {
    const config = await loadGlobalConfig();
    const profiles = profilesOf(config);
    const names = Object.entries(profiles).map(([name, profile]) => `${name}${config.activeProfile === name ? ' (active)' : ''} — ${profile.model ?? '(current model)'}`);
    return { output: names.length ? names.join('\n') : 'No profiles configured.', ok: true };
  },
};

const SECRET_KEY = /api[-_]?key|token|secret|password|credential/i;
const SECRET_MAP = /^provider[_-]?keys?$/i;
/**
 * Containers whose contents are credentials whatever the keys are called.
 *
 * Redacting by key name alone leaks the two places a credential actually
 * lives: an HTTP MCP server keeps its bearer token in `headers.Authorization`,
 * and a stdio one keeps it in `env` under whatever the vendor named the
 * variable. Neither matches a name denylist, and this output goes to the model
 * and therefore to the model's endpoint — so the location has to be the rule.
 */
const SECRET_CONTAINER = /^(headers|env)$/i;

export function redactedConfig(config: GlobalConfig): unknown {
  const hide = (value: unknown, key: string, sealed: boolean): unknown => {
    if (SECRET_KEY.test(key)) return value ? '[redacted]' : value;
    if (SECRET_MAP.test(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([provider, credential]) => [
          provider,
          credential ? '[redacted]' : credential,
        ]),
      );
    }
    if (sealed && (value === null || typeof value !== 'object')) {
      return value ? '[redacted]' : value;
    }
    if (Array.isArray(value)) return value.map((item) => hide(item, '', sealed));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          hide(child, childKey, sealed || SECRET_CONTAINER.test(childKey)),
        ]),
      );
    }
    return value;
  };
  return hide(config, '', false);
}

export const getConfig: Tool = {
  parallelSafe: true,
  repeatable: true,
  spec: {
    name: 'get_config',
    description: 'Read Plif configuration with credentials redacted. Use this before proposing a configuration change.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run() {
    const [config, schema] = await Promise.all([loadGlobalConfig(), configSchemaText()]);
    return {
      output: [
        'Status: success',
        `Summary: loaded personal configuration from ${globalConfigPath()}.`,
        '',
        'Configuration (TOML, credentials redacted):',
        formatConfigToml(redactedConfig(config) as GlobalConfig).trim(),
        '',
        'Configuration reference (TOML):',
        schema.trim(),
        '',
        'Next: preserve unrelated fields and use update_config with the smallest valid change.',
      ].join('\n'),
      ok: true,
    };
  },
};

export const updateConfig: Tool = {
  spec: {
    name: 'update_config',
    description:
      'Update Plif configuration. When Auto Approve is off, Plif opens a navigable confirmation panel before writing. ' +
      'Can change the active model, vision model, Auto Approve, or add an OpenAI-compatible provider/model.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['set_model', 'set_vision_model', 'set_theme', 'set_auto_approve', 'upsert_provider'] },
        value: { type: 'string', description: 'Model ref for model operations, or theme id for set_theme' },
        enabled: { type: 'boolean', description: 'New value for set_auto_approve' },
        provider: { type: 'string', description: 'Provider id for upsert_provider' },
        name: { type: 'string', description: 'Human-readable provider name' },
        baseURL: { type: 'string', description: 'OpenAI-compatible API base URL' },
        model: { type: 'string', description: 'Optional model id to add to the provider' },
        modelName: { type: 'string', description: 'Optional human-readable model name' },
        modalities: { type: 'array', items: { type: 'string', enum: ['text', 'image'] } },
        contextWindow: { type: 'number' },
        cost: { type: 'string', enum: ['free', 'paid', 'unknown'] },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    // Credentials belong to the encrypted broker or a provider-specific
    // environment variable. Accepting one here would either leak it into a
    // model tool call or claim success after the TOML writer strips it.
    if (Object.prototype.hasOwnProperty.call(input, 'apiKey')) {
      throw new PlifError(
        'INVALID_ARGUMENT',
        'update_config does not accept API keys',
        { hint: 'Use /models to open the encrypted credential prompt, or set the provider-specific environment variable.' },
      );
    }
    const operation = requireString(input, 'operation');
    const current = await loadGlobalConfig();
    let next: GlobalConfig;
    let summary: string;

    if (operation === 'set_model' || operation === 'set_vision_model' || operation === 'set_theme') {
      const value = requireString(input, 'value');
      const key = operation === 'set_model' ? 'model' : operation === 'set_theme' ? 'theme' : 'visionModel';
      next = { ...current, [key]: value };
      summary = `${key}: ${value}`;
    } else if (operation === 'set_auto_approve') {
      if (typeof input['enabled'] !== 'boolean') throw new PlifError('INVALID_ARGUMENT', 'enabled must be a boolean');
      next = {
        ...current,
        autoApprove: input['enabled'],
        permissionMode: input['enabled'] ? 'auto-approve' : 'ask',
      };
      summary = `Auto Approve: ${input['enabled'] ? '✓' : '×'}`;
    } else if (operation === 'upsert_provider') {
      const provider = requireString(input, 'provider');
      const baseURL = requireString(input, 'baseURL');
      const providerMap = current.provider && typeof current.provider === 'object'
        ? { ...(current.provider as Record<string, unknown>) }
        : {};
      const previous = providerMap[provider] && typeof providerMap[provider] === 'object'
        ? providerMap[provider] as Record<string, unknown>
        : {};
      const previousOptions = previous['options'] && typeof previous['options'] === 'object'
        ? previous['options'] as Record<string, unknown>
        : {};
      const model = typeof input['model'] === 'string' ? input['model'].trim() : '';
      const previousModels = previous['models'] && typeof previous['models'] === 'object'
        ? previous['models'] as Record<string, unknown>
        : {};
      const modelEntry = model ? {
        name: typeof input['modelName'] === 'string' ? input['modelName'] : model,
        modalities: Array.isArray(input['modalities']) ? input['modalities'] : ['text'],
        ...(typeof input['contextWindow'] === 'number' ? { contextWindow: input['contextWindow'] } : {}),
        ...(typeof input['cost'] === 'string' ? { cost: input['cost'] } : {}),
      } : undefined;
      providerMap[provider] = {
        ...previous,
        sdk: 'openai',
        name: typeof input['name'] === 'string' ? input['name'] : provider,
        options: {
          ...previousOptions,
          baseURL,
        },
        models: model ? { ...previousModels, [model]: modelEntry } : previousModels,
      };
      next = { ...current, provider: providerMap };
      summary = `Provider ${provider} (${baseURL})${model ? ` with model ${model}` : ''}`;
    } else {
      throw new PlifError('INVALID_ARGUMENT', `Unsupported configuration operation: ${operation}`);
    }

    if (!isAutoApproveEnabled(current)) {
      const answer = await context.questions.ask({
        text: 'Allow this Plif configuration change?',
        options: [
          { value: 'approve', label: 'Apply change', description: 'Write this update to ~/.plif/config.toml.' },
          { value: 'cancel', label: 'Cancel', description: 'Leave the current configuration untouched.' },
        ],
        context: summary,
      });
      if (answer !== 'approve') return { output: 'Configuration was not changed.', ok: false };
    }

    await saveGlobalConfig(next);
    return {
      output: [
        'Status: success',
        `Summary: configuration updated at ${globalConfigPath()}.`,
        `Change: ${summary}.`,
        'Next: use get_config to inspect the effective redacted configuration.',
      ].join('\n'),
      ok: true,
    };
  },
};

export const createProfile: Tool = {
  spec: { name: 'create_profile', description: 'Create a persistent main-agent profile. Plif confirms through the picker unless Auto Approve is enabled.', parameters: { type: 'object', properties: { name: { type: 'string' }, model: { type: 'string' }, systemPrompt: { type: 'string' } }, required: ['name', 'model', 'systemPrompt'], additionalProperties: false } },
  async run(input, context) {
    const name = requireString(input, 'name');
    const model = requireString(input, 'model');
    const systemPrompt = requireString(input, 'systemPrompt');

    // Check the model before asking anyone to approve it. A profile saved
    // against a model id that does not resolve looks fine on disk and fails at
    // the moment it is activated — which is the worst place to find out, since
    // activating resets the conversation.
    const stored = (await loadGlobalConfig()) as StoredConfig;
    const ref = parseModelRef(model);
    const usable = validateModel(
      resolveConfig(stored, {
        model: ref.model,
        ...(ref.preset ? { preset: ref.preset } : {}),
      }),
    );
    if (!usable.ok) {
      return {
        output:
          `Cannot save "${name}": the model "${model}" is not usable — ${usable.problem}. ` +
          (usable.hint ?? '') +
          ' Pick a model that resolves, then propose the profile again.',
        ok: false,
      };
    }

    const config = await loadGlobalConfig();
    if (!isAutoApproveEnabled(config)) {
      const answer = await context.questions.ask({
        text: `Save the AI profile "${name}" for future use?`,
        options: [
          { value: 'approve', label: 'Save profile', description: 'Persist this model and identity in ~/.plif/config.toml.' },
          { value: 'cancel', label: 'Cancel', description: 'Do not change configuration.' },
        ],
        context: `Model: ${model}\nIdentity: ${systemPrompt}`,
      });
      if (answer !== 'approve') return { output: 'Profile was not saved.', ok: false };
    }
    const profiles = { ...profilesOf(config), [name]: { name, model, systemPrompt } };
    await saveGlobalConfig({ ...config, profiles });
    return { output: `Profile ${name} saved at ${globalConfigPath()}. It is not active until the user activates it.`, ok: true };
  },
};

export const activateProfile: Tool = {
  spec: { name: 'activate_profile', description: 'Switch to a saved main-agent identity. Plif confirms unless Auto Approve is enabled.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } },
  async run(input, context) {
    const name = requireString(input, 'name');
    const config = await loadGlobalConfig();
    if (!profilesOf(config)[name]) return { output: `No profile named ${name}.`, ok: false };
    if (!isAutoApproveEnabled(config)) {
      const answer = await context.questions.ask({
        text: `Activate the AI profile "${name}" and restart the conversation?`,
        options: [
          { value: 'approve', label: 'Activate profile', description: 'Switch identity and begin a fresh conversation.' },
          { value: 'cancel', label: 'Cancel', description: 'Keep the current profile and conversation.' },
        ],
        context: profilesOf(config)[name]?.systemPrompt,
      });
      if (answer !== 'approve') return { output: 'Profile was not activated.', ok: false };
    }
    if (context.activateProfile) await context.activateProfile(name);
    else await saveGlobalConfig({ ...config, activeProfile: name });
    return { output: `Profile ${name} is now active.`, ok: true };
  },
};

export const remember: Tool = {
  spec: {
    name: 'remember',
    description:
      'Record something durable about this project that a future session should know — ' +
      'a build command, a convention, a gotcha, or an approach that did not work. ' +
      'Only record what you verified. Do not record what is already obvious from the code.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'One sentence, specific and checkable' },
        kind: {
          type: 'string',
          enum: ['fact', 'failure'],
          description: '"fact" for what is true, "failure" for what does not work',
        },
        scope: {
          type: 'string',
          enum: ['workspace', 'global'],
          description: 'Use workspace by default; choose global only for facts that apply to every project.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.memory || !context.workspace) {
      return { output: 'Memory is not available in this run.', ok: false };
    }
    if (context.readOnlyMemory) {
      return { output: 'Memory is read-only for subagents. Ask the main agent to record this.', ok: false };
    }
    const text = requireString(input, 'text');
    if (/(?:^|[^A-Za-z0-9_])sk_[A-Za-z0-9_-]{16,}/.test(text)) {
      return { output: 'Credentials cannot be stored in memory. Use /env instead.', ok: false };
    }
    const kind = input['kind'] === 'failure' ? 'failure' : 'fact';
    const scope = input['scope'] === 'global' ? 'global' : 'workspace';
    const stored = await context.memory.remember({ workspace: context.workspace, kind, text, scope });
    return {
      output: `Recorded as ${kind}${stored.confirmations > 1 ? ` (confirmed ${stored.confirmations}x)` : ''}.`,
      ok: true,
    };
  },
};

export const setGoal: Tool = {
  spec: {
    name: 'set_goal',
    description:
      'Set the session goal that guides future turns. Use this only when the user has not set /goal themselves, ' +
      'after asking clarifying questions with ask_user and using the Galileo skill to infer the underlying objective. ' +
      'This records context only; it does not start work or claim completion.',
    parameters: {
      type: 'object',
      properties: {
        condition: { type: 'string', description: 'A concise description of the user\'s final desired outcome' },
      },
      required: ['condition'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.goal && !context.setGoal) return { output: 'Session goals are not available in this run.', ok: false };
    const condition = requireString(input, 'condition').trim();
    if (condition.length > 2000) {
      throw new PlifError('INVALID_ARGUMENT', 'goal condition must be 2000 characters or fewer');
    }
    if (context.goal) await context.goal.setModelGoal(condition);
    else await context.setGoal?.(condition);
    return {
      output: 'Session goal recorded (not armed) without starting work. It will guide future turns without starting autonomous rounds.',
      ok: true,
    };
  },
};

export const getGoal: Tool = {
  parallelSafe: true,
  spec: {
    name: 'get_goal',
    description: 'Read the durable workspace goal, including status, exact revision, rounds, and whether autonomous rounds are armed.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(_input, context) {
    const state = context.goal?.get();
    return state
      ? { output: JSON.stringify({
          condition: state.condition,
          status: state.status,
          revision: state.revision,
          rounds: state.rounds,
          maxRounds: state.maxRounds,
          armed: state.armed,
          blockedReason: state.blockedReason,
        }), ok: true }
      : { output: 'No goal is configured for this workspace.', ok: true };
  },
};

function goalRevision(input: Record<string, unknown>): number {
  const value = input['revision'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new PlifError('INVALID_ARGUMENT', 'goal mutation requires the exact integer "revision" from get_goal');
  }
  return value;
}

export const completeGoal: Tool = {
  spec: {
    name: 'complete_goal',
    description: 'Mark the active durable goal complete after it is genuinely achieved. Requires exact revision and concrete evidence.',
    parameters: {
      type: 'object',
      properties: {
        revision: { type: 'integer', description: 'Exact revision returned by get_goal.' },
        evidence: { type: 'string', description: 'Commands, tests, or other evidence proving completion.' },
      },
      required: ['revision', 'evidence'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.goal) return { output: 'Durable goals are not available in this run.', ok: false };
    const evidence = requireString(input, 'evidence');
    const state = await context.goal.complete(goalRevision(input), evidence);
    return { output: `Goal completed at revision ${state.revision}. Evidence recorded.`, ok: true };
  },
};

export const blockGoal: Tool = {
  spec: {
    name: 'block_goal',
    description: 'Block an active goal only when the same concrete blocker persisted across at least 3 rounds. Requires exact revision.',
    parameters: {
      type: 'object',
      properties: {
        revision: { type: 'integer', description: 'Exact revision returned by get_goal.' },
        reason: { type: 'string', description: 'Concrete blocker and what dependency is missing.' },
      },
      required: ['revision', 'reason'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.goal) return { output: 'Durable goals are not available in this run.', ok: false };
    const state = await context.goal.block(goalRevision(input), requireString(input, 'reason'));
    return { output: `Goal blocked at revision ${state.revision}: ${state.blockedReason ?? 'unspecified blocker'}`, ok: true };
  },
};

interface SessionSearchHit {
  readonly sessionId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly score: number;
  readonly excerpts: string[];
}

function eventSearchText(event: ConversationEvent): string {
  switch (event.kind) {
    case 'user.message':
    case 'assistant.message':
      return event.text;
    case 'command.input':
      return event.argv.join(' ');
    case 'command.completed':
      return `${event.stdout}\n${event.stderr}`;
    case 'terminal.output':
      return event.text;
    case 'queued.input':
      return event.text;
    case 'tool.completed':
      return event.output.slice(0, 500);
    default:
      return '';
  }
}

function excerptsFor(text: string, query: string): string[] {
  const lower = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const results: string[] = [];
  let from = 0;
  while (results.length < 3) {
    const found = lower.indexOf(needle, from);
    if (found < 0) break;
    const start = Math.max(0, found - 60);
    const end = Math.min(text.length, found + query.length + 60);
    results.push(`${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`);
    from = found + Math.max(1, needle.length);
  }
  return results;
}

function searchPayload(hits: SessionSearchHit[]): string {
  let current = hits.map((hit) => ({
    ...hit,
    title: hit.title.slice(0, 160),
    excerpts: hit.excerpts.map((excerpt) => excerpt.slice(0, 500)),
  }));
  let serialized = JSON.stringify(current);
  while (serialized.length > 5_000 && current.length > 0) {
    const last = current[current.length - 1]!;
    const excerpt = last.excerpts.at(-1);
    if (last.excerpts.length > 1) last.excerpts.pop();
    else if (excerpt && excerpt.length > 100) {
      last.excerpts[last.excerpts.length - 1] = `${excerpt.slice(0, Math.max(80, excerpt.length - 100))}…`;
    } else current.pop();
    serialized = JSON.stringify(current);
  }
  if (serialized.length <= 5_000) return serialized;
  // Keep the contract valid JSON even when a future metadata field grows.
  return JSON.stringify(current.map((hit) => ({
    ...hit,
    title: hit.title.slice(0, 80),
    excerpts: hit.excerpts.map((excerpt) => excerpt.slice(0, 80)),
  })));
}

export const sessionSearch: Tool = {
  parallelSafe: true,
  spec: {
    name: 'session_search',
    description:
      'Search the 20 most recent sessions in this workspace for a case-insensitive query. ' +
      'Returns ranked sessions with matching excerpts. This is read-only and never searches other workspaces.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms; case-insensitive substring.' },
        limit: { type: 'integer', description: 'Maximum sessions to return, default 3, maximum 5.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.sessions || !context.workspace) return { output: 'Session search is not available in this run.', ok: false };
    const query = requireString(input, 'query').trim();
    if (!query) throw new PlifError('INVALID_ARGUMENT', 'session_search requires a non-empty query');
    if (query.length > 500) throw new PlifError('INVALID_ARGUMENT', 'session_search query must be 500 characters or fewer');
    const limit = typeof input['limit'] === 'number' && Number.isFinite(input['limit'])
      ? Math.min(5, Math.max(1, Math.floor(input['limit'])))
      : 3;
    const metas = (await context.sessions.list(context.workspace)).slice(0, 20);
    const ranked: SessionSearchHit[] = [];
    for (let index = 0; index < metas.length; index += 1) {
      const meta = metas[index] as (typeof metas)[number];
      const session = await context.sessions.resolve(context.workspace, meta.id);
      if (!session) continue;
      const chunks: string[] = [];
      for (const event of await session.history()) {
        const text = eventSearchText(event);
        if (text) chunks.push(text);
      }
      const combined = chunks.join('\n');
      const matches = excerptsFor(combined, query);
      if (matches.length === 0) continue;
      const occurrences = combined.toLocaleLowerCase().split(query.toLocaleLowerCase()).length - 1;
      const recencyBonus = metas.length <= 1 ? 0.1 : 0.1 * ((metas.length - index) / metas.length);
      ranked.push({
        sessionId: meta.id,
        title: meta.title || '(untitled session)',
        updatedAt: meta.updatedAt,
        score: Number((occurrences * (1 + recencyBonus)).toFixed(3)),
        excerpts: matches,
      });
    }
    ranked.sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt));
    if (ranked.length === 0) return { output: 'No matching sessions.', ok: true };
    return { output: searchPayload(ranked.slice(0, limit)), ok: true };
  },
};

export type PlanStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanCheckpoint {
  readonly step: string;
  readonly status: PlanStatus;
}

/** Keep plans useful as navigation without turning the timeline into a backlog. */
export const updatePlan: Tool = {
  spec: {
    name: 'update_plan',
    description:
      'Set a short execution plan before authorized file changes. Use 1-6 concise checkpoints, ' +
      'update it only at meaningful checkpoint boundaries, and keep at most one checkpoint in progress. ' +
      'In workspace runs the runtime also writes a durable Markdown checkpoint mirror under .plif/plans/.',
    parameters: {
      type: 'object',
      properties: {
        explanation: {
          type: 'string',
          description: 'Optional one-sentence reason the plan changed; do not narrate routine progress.',
        },
        objective: {
          type: 'string',
          description: 'Optional concise objective for the durable Markdown checkpoint mirror.',
        },
        plan: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', description: 'A short outcome-oriented checkpoint.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['step', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['plan'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const raw = input['plan'];
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 6) {
      throw new PlifError('INVALID_ARGUMENT', 'update_plan needs between 1 and 6 checkpoints');
    }

    const checkpoints = raw.map((value, index): PlanCheckpoint => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PlifError('INVALID_ARGUMENT', `plan checkpoint ${index + 1} must be an object`);
      }
      const record = value as Record<string, unknown>;
      const step = typeof record['step'] === 'string' ? record['step'].trim() : '';
      const status = record['status'];
      if (!step) {
        throw new PlifError('INVALID_ARGUMENT', `plan checkpoint ${index + 1} needs a short step`);
      }
      if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') {
        throw new PlifError('INVALID_ARGUMENT', `plan checkpoint ${index + 1} has an invalid status`);
      }
      return { step, status };
    });

    if (checkpoints.filter((checkpoint) => checkpoint.status === 'in_progress').length > 1) {
      throw new PlifError('INVALID_ARGUMENT', 'update_plan allows at most one checkpoint in progress');
    }

    const completed = checkpoints.filter((checkpoint) => checkpoint.status === 'completed').length;
    const active = checkpoints.find((checkpoint) => checkpoint.status === 'in_progress');
    let durable = '';
    if (context.workspace) {
      const root = context.container.workdir.replace(/[\\/]+$/, '');
      const child = context.agentId?.startsWith('subagent:')
        ? `/subagents/${context.agentId.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 96)}.md`
        : '/current.md';
      const planPath = `${root}/.plif/plans${child}`;
      const objective = typeof input['objective'] === 'string' && input['objective'].trim()
        ? input['objective'].trim()
        : checkpoints[0]!.step;
      const explanation = typeof input['explanation'] === 'string' && input['explanation'].trim()
        ? input['explanation'].trim()
        : 'No additional checkpoint rationale was supplied.';
      const rows = checkpoints.map((checkpoint) => {
        const mark = checkpoint.status === 'completed' ? 'x' : checkpoint.status === 'in_progress' ? '-' : ' ';
        return `- [${mark}] ${checkpoint.step} _(${checkpoint.status})_`;
      });
      const markdown = [
        '# Plif execution checkpoint',
        '',
        '## Objective',
        '',
        objective,
        '',
        '## Current evidence',
        '',
        explanation,
        '',
        '## Checkpoints with acceptance evidence',
        '',
        ...rows,
        '',
        '## Delegated ownership',
        '',
        context.agentId ? `- Owner: ${context.agentId}` : '- Owner: primary agent',
        '',
        '## Verification matrix',
        '',
        '- Record commands and observed results in the detailed task plan.',
        '',
        '## Review and audit findings',
        '',
        '- Pending synchronization from the detailed task plan.',
        '',
        '## Current status and exact next action',
        '',
        active?.step ?? (completed === checkpoints.length ? 'All visible checkpoints are complete.' : 'Select the next pending checkpoint.'),
        '',
      ].join('\n');
      await context.container.writeFile(planPath, markdown);
      durable = ` Durable checkpoint: ${planPath}.`;
    }
    return {
      output:
        `Plan updated: ${completed}/${checkpoints.length} checkpoints completed.` +
        (active ? ` Current checkpoint: ${active.step}.` : '') +
        durable,
      ok: true,
    };
  },
};

export const startTask: Tool = {
  spec: {
    name: 'start_task',
    description:
      'Start a long-running command in the background. It always requires human confirmation unless Auto Approve is enabled. Use a concrete title, argv array, reason, and a clear completion condition.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable task title' },
        argv: { type: 'array', items: { type: 'string' }, description: 'Command and arguments' },
        reason: { type: 'string', description: 'Why this must continue in the background' },
      },
      required: ['title', 'argv', 'reason'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.tasks) return { output: 'Background tasks are not available in this run.', ok: false };
    const title = requireString(input, 'title');
    const reason = requireString(input, 'reason');
    const argv = input['argv'];
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((part) => typeof part === 'string')) {
      throw new PlifError('INVALID_ARGUMENT', 'start_task needs a non-empty argv array');
    }
    const task = await context.tasks.create({ title, reason, argv: argv as string[] });
    // Keep the task asynchronous at the runtime boundary, but do not make the
    // model spend inference turns asking whether it changed. TaskManager's
    // TaskMonitor waits on native task events and returns one proper tool
    // result when the work is actionable.
    const waited = task.status === 'running'
      ? await context.tasks.waitFor(task.id, { signal: context.signal })
      : null;
    const settled = waited?.result ?? context.tasks.get(task.id) ?? task;
    const output = [
      `${settled.id} ${settled.status}: ${settled.title}`,
      settled.argv.join(' '),
      settled.stdout ? `stdout:\n${settled.stdout}` : '',
      settled.stderr ? `stderr:\n${settled.stderr}` : '',
      settled.error ? `error: ${settled.error}` : '',
      waited?.status === 'timed_out' ? 'monitor: timed out while waiting for the task' : '',
      waited?.status === 'cancelled' ? 'monitor: waiting was cancelled' : '',
    ].filter(Boolean).join('\n');
    return {
      output,
      ok: settled.status === 'done' || settled.status === 'running' || settled.status === 'awaiting_approval',
    };
  },
};

export const listTasks: Tool = {
  parallelSafe: true,
  repeatable: true,
  spec: {
    name: 'list_tasks',
    description: 'List background tasks belonging to this agent and container.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(_input, context) {
    if (!context.tasks) return { output: 'Background tasks are not available in this run.', ok: false };
    const tasks = context.tasks.list();
    return {
      output: tasks.length === 0
        ? 'No background tasks.'
        : tasks.map((task) => `${task.id} ${task.status} ${task.title}`).join('\n'),
      ok: true,
    };
  },
};

export const taskStatus: Tool = {
  parallelSafe: true,
  repeatable: true,
  spec: {
    name: 'task_status',
    description: 'Show the status and recent output of one background task.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Task id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.tasks) return { output: 'Background tasks are not available in this run.', ok: false };
    const task = context.tasks.get(requireString(input, 'id'));
    if (!task) return { output: 'No task with that id.', ok: false };
    return {
      output: [
        `${task.id} ${task.status} ${task.title}`,
        task.argv.join(' '),
        task.stdout ? `stdout:\n${task.stdout}` : '',
        task.stderr ? `stderr:\n${task.stderr}` : '',
        task.error ? `error: ${task.error}` : '',
      ].filter(Boolean).join('\n'),
      ok: task.status !== 'failed' && task.status !== 'blocked',
    };
  },
};

export const cancelTask: Tool = {
  spec: {
    name: 'cancel_task',
    description: 'Cancel a running background task by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Task id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.tasks) return { output: 'Background tasks are not available in this run.', ok: false };
    const task = await context.tasks.cancel(requireString(input, 'id'));
    return task ? { output: `${task.id} ${task.status}`, ok: true } : { output: 'No task with that id.', ok: false };
  },
};

export const editConflicts: Tool = {
  spec: { name: 'edit_conflicts', description: 'List all unresolved concurrent file-edit conflicts for the principal agent.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  async run(_input, context) {
    if (!context.edits) return { output: 'Edit coordination is unavailable.', ok: false };
    const conflicts = context.edits.list();
    return { output: conflicts.length ? JSON.stringify(conflicts) : 'No unresolved edit conflicts.', ok: true };
  },
};

export const resolveEditConflict: Tool = {
  spec: { name: 'resolve_edit_conflict', description: 'Apply the principal agent\'s chosen merged content to an edit conflict.', parameters: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'], additionalProperties: false } },
  async run(input, context) {
    if (!context.edits) return { output: 'Edit coordination is unavailable.', ok: false };
    await context.edits.resolve(requireString(input, 'id'), typeof input.content === 'string' ? input.content : '', context.container);
    return { output: 'Conflict resolved and merged content applied.', ok: true };
  },
};

export const DEFAULT_TOOLS: readonly Tool[] = [
  readFile,
  writeFile,
  editFile,
  listDir,
  globFiles,
  grepFiles,
  applyPatch,
  runCommand,
  terminalStart,
  terminalWrite,
  terminalRead,
  terminalResize,
  terminalSignal,
  terminalClose,
  askUser,
  getConfig,
  updateConfig,
  updatePlan,
  remember,
  setGoal,
  getGoal,
  completeGoal,
  blockGoal,
  sessionSearch,
  startTask,
  listTasks,
  taskStatus,
  cancelTask,
  editConflicts,
  resolveEditConflict,
  listProfiles,
  createProfile,
  activateProfile,
];

/** Build a stable session tool set without making DEFAULT_TOOLS platform-specific. */
export function toolsForEnvironment(
  resolution: ShellDialectResolution | null | undefined,
  extras: readonly Tool[] = [],
): readonly Tool[] {
  return [
    ...DEFAULT_TOOLS,
    ...(resolution?.dialect ? [shellCommand] : []),
    ...extras,
  ];
}

export function toolRegistry(tools: readonly Tool[] = DEFAULT_TOOLS): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.spec.name, tool]));
}

export function toolSpecs(tools: readonly Tool[] = DEFAULT_TOOLS): ToolSpec[] {
  return tools.map((tool) => tool.spec);
}
