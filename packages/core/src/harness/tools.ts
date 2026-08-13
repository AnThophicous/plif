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
  readonly workspace?: string;
  readonly tasks?: TaskManager;
  readonly lsp?: LspManager;
  readonly edits?: EditCoordinator;
  readonly agentId?: string;
  readonly activateProfile?: (name: string) => Promise<void>;
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
    const entries = await context.container.listDir(path);
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

interface WalkedFile {
  readonly absolute: string;
  readonly relative: string;
}

async function walkFiles(container: Container, root: string): Promise<WalkedFile[]> {
  const normalizedRoot = normalizeToolPath(root);
  const pending = [normalizedRoot];
  const files: WalkedFile[] = [];
  let visited = 0;

  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await container.listDir(directory);
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_DISCOVERY_ENTRIES) {
        throw new PlifError('INVALID_ARGUMENT', `discovery exceeded ${MAX_DISCOVERY_ENTRIES} entries`, {
          hint: 'Use a narrower path or pattern.',
        });
      }
      const absolute = joinToolPath(directory, entry.name);
      if (entry.kind === 'directory') pending.push(absolute);
      else files.push({ absolute, relative: relativeToolPath(normalizedRoot, absolute) });
    }
  }

  return files;
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
    const matches = (await walkFiles(context.container, root))
      .filter((file) => matcher.test(file.relative))
      .map((file) => file.absolute)
      .sort()
      .slice(0, limit);
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
    const include = typeof input['include'] === 'string' ? globExpression(input['include']) : null;
    const matches: string[] = [];

    for (const file of await walkFiles(context.container, root)) {
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
    return { output: summary, diff: diffs.join('\n'), ok: true };
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

    // Both streams are labelled and the exit code is always stated. A model
    // shown only stdout cannot tell a warning-and-succeeded from a failure.
    const parts: string[] = [`exit ${result.exitCode}${result.killedBy ? ` (${result.killedBy})` : ''}`];
    if (result.stdout.trim()) parts.push(`stdout:\n${compactTerminal(result.stdout)}`);
    if (result.stderr.trim()) parts.push(`stderr:\n${compactTerminal(result.stderr)}`);
    if (result.truncated) parts.push('(output truncated at the container limit)');
    if (parts.length === 1) parts.push('(no output)');

    return {
      output: clip(parts.join('\n')),
      display: [
        `exit ${result.exitCode}${result.killedBy ? ` (${result.killedBy})` : ''}`,
        result.stdout.trimEnd(),
        result.stderr.trimEnd(),
        result.truncated ? '(output truncated at the container limit)' : '',
      ].filter(Boolean).join('\n'),
      ok: result.exitCode === 0 && !result.killedBy,
    };
  },
};

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
      required: ['question'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    const question = requireString(input, 'question');
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

    const answer = await context.questions.ask({
      text: question,
      ...(options?.length ? { options } : {}),
      ...(typeof input['context'] === 'string' ? { context: input['context'] } : {}),
    });

    if (answer === null) {
      // Say plainly that nobody answered. An agent told "no response" will pick
      // a default and note the assumption; an agent handed a fabricated answer
      // will proceed as if the human agreed to something they never saw.
      return {
        output:
          'No answer — the human did not respond in time. Choose the most defensible ' +
          'default, state clearly which assumption you made, and continue.',
        ok: false,
      };
    }
    return { output: `The human answered: ${answer}`, ok: true };
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
    const config = await loadGlobalConfig();
    return { output: JSON.stringify(redactedConfig(config), null, 2), ok: true };
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
        apiKey: { type: 'string', description: 'Optional provider credential; never shown in transcripts' },
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
      summary = `Auto Approve: ${input['enabled'] ? 'on' : 'off'}`;
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
          ...(typeof input['apiKey'] === 'string' ? { apiKey: input['apiKey'] } : {}),
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
          { value: 'approve', label: 'Apply change', description: 'Write this update to config.jsonc.' },
          { value: 'cancel', label: 'Cancel', description: 'Leave the current configuration untouched.' },
        ],
        context: summary,
      });
      if (answer !== 'approve') return { output: 'Configuration was not changed.', ok: false };
    }

    await saveGlobalConfig(next);
    return { output: `Configuration updated: ${summary}.`, ok: true };
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
          { value: 'approve', label: 'Save profile', description: 'Persist this model and identity in config.jsonc.' },
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
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    if (!context.memory || !context.workspace) {
      return { output: 'Memory is not available in this run.', ok: false };
    }
    const text = requireString(input, 'text');
    const kind = input['kind'] === 'failure' ? 'failure' : 'fact';
    const stored = await context.memory.remember({ workspace: context.workspace, kind, text });
    return {
      output: `Recorded as ${kind}${stored.confirmations > 1 ? ` (confirmed ${stored.confirmations}x)` : ''}.`,
      ok: true,
    };
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
      'Set a short execution plan for genuinely multi-step work. Use 2-6 concise checkpoints, ' +
      'update it only at meaningful checkpoint boundaries, and keep at most one checkpoint in progress.',
    parameters: {
      type: 'object',
      properties: {
        explanation: {
          type: 'string',
          description: 'Optional one-sentence reason the plan changed; do not narrate routine progress.',
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
  async run(input) {
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
    return {
      output:
        `Plan updated: ${completed}/${checkpoints.length} checkpoints completed.` +
        (active ? ` Current checkpoint: ${active.step}` : ''),
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
    return {
      output: `${task.id} ${task.status}: ${task.title}\n${task.argv.join(' ')}` +
        (task.error ? `\nblocked: ${task.error}` : ''),
      ok: task.status === 'running' || task.status === 'awaiting_approval',
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
  askUser,
  getConfig,
  updateConfig,
  updatePlan,
  remember,
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

export function toolRegistry(tools: readonly Tool[] = DEFAULT_TOOLS): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.spec.name, tool]));
}

export function toolSpecs(tools: readonly Tool[] = DEFAULT_TOOLS): ToolSpec[] {
  return tools.map((tool) => tool.spec);
}
