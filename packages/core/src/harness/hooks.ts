/**
 * Hooks: "whenever X happens, run Y".
 *
 * The three harnesses plif is being measured against all ship hooks as
 * JavaScript modules that the agent imports and calls in-process. That shape
 * is more expressive than this one, and plif deliberately does not copy it: a
 * module loaded into the agent process runs with the host's full privileges,
 * outside the path jail, outside the policy engine, and outside the audit log.
 * It would be the one thing in plif that can do more than the tools can, which
 * inverts the entire security story — a user who installs a hook to format
 * their code would be handing a plugin author more power than the model has.
 *
 * So a plif hook is a **command**, and it runs through `Container.exec` like
 * everything else. The path jail applies. The policy engine reviews it. The
 * audit log records it. A hook is exactly as privileged as the `run_command`
 * the model could have issued, and no more.
 *
 * What is given up is the ability to rewrite a tool's arguments in memory.
 * What is kept is that installing a hook cannot escalate anything, which for a
 * feature whose whole purpose is to run on somebody else's machine, in
 * response to somebody else's prompt, is the trade worth making.
 *
 * ## The contract
 *
 * A hook receives its event as JSON on stdin and as `PLIF_HOOK_*` environment
 * variables, and answers with an exit code:
 *
 * | Exit | Meaning                                                          |
 * | ---- | ---------------------------------------------------------------- |
 * | 0    | Allow. `stdout` is added to the model's context when non-empty.  |
 * | 2    | Block. `stderr` is the reason, and it is shown to the model.     |
 * | else | Failed. Recorded and surfaced, but the action proceeds.          |
 *
 * The split between 2 and "anything else" matters: a hook that crashes because
 * its interpreter is missing must not silently become a deny-all that makes
 * the agent look broken, and a hook that means to refuse must not be
 * indistinguishable from one that fell over.
 */

import { PlifError } from '../errors.js';
import type { Container } from '../container/container.js';
import type { EventBus } from '../events/bus.js';
import type { ShellDialect } from '../execution/shell-dialects.js';

/**
 * The moments a hook can attach to.
 *
 * Kept small and specific. Every one of these is a point where the loop
 * already has a decision to make, which is what makes the hook's answer
 * actionable rather than advisory.
 */
export type HookEvent =
  /** Before a tool runs. The only event whose hook can block. */
  | 'tool.before'
  /** After a tool ran, successfully or not. */
  | 'tool.after'
  /** The user submitted a prompt, before the model sees it. */
  | 'user.prompt'
  /** A turn finished and the agent is about to hand control back. */
  | 'turn.end'
  /** The session is starting. */
  | 'session.start'
  /** The session is ending. */
  | 'session.end';

export const HOOK_EVENTS: readonly HookEvent[] = Object.freeze([
  'tool.before',
  'tool.after',
  'user.prompt',
  'turn.end',
  'session.start',
  'session.end',
]);

export function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === 'string' && (HOOK_EVENTS as readonly string[]).includes(value);
}

export interface HookDefinition {
  readonly event: HookEvent;
  /**
   * A regular expression the event's subject must match.
   *
   * The subject is the tool name for `tool.*`, and the prompt text for
   * `user.prompt`. Absent means every event of this kind. Anchor it if you
   * mean an exact name: `edit_file` also matches `edit_file_v2`.
   */
  readonly match?: string;
  /** The script to run, in the session's shell dialect. */
  readonly command: string;
  /** Defaults to 30s. A hook is on the critical path of a tool call. */
  readonly timeoutMs?: number;
  /** Shown in the timeline and the audit log instead of the raw command. */
  readonly name?: string;
}

/** What the loop learns from running the hooks for one event. */
export interface HookOutcome {
  /** Set when a hook exited 2. The action must not proceed. */
  readonly blocked?: { readonly reason: string; readonly hook: string };
  /** Non-empty stdout from allowing hooks, for the model to read. */
  readonly context: readonly string[];
  /** Hooks that failed for a reason other than a deliberate block. */
  readonly failures: readonly { readonly hook: string; readonly detail: string }[];
}

const EMPTY_OUTCOME: HookOutcome = Object.freeze({ context: [], failures: [] });

const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * A hook's stdout is model context, so it is capped like any other tool output.
 * A formatter that decides to print the whole file must not be able to spend
 * the context window on it.
 */
const MAX_CONTEXT_BYTES = 4_000;

/** The exit code that means "refuse this action", as opposed to "I broke". */
const BLOCK_EXIT_CODE = 2;

export interface HookEventPayload {
  readonly event: HookEvent;
  /** Tool name, or the first line of the prompt — whatever `match` tests. */
  readonly subject?: string;
  /** Tool arguments, tool result, prompt text: whatever the event carries. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Parse hook definitions from configuration.
 *
 * Invalid entries are dropped with a reason rather than throwing, because a
 * typo in one hook must not stop the session from starting — but the reason is
 * returned rather than swallowed, so the interface can say what was ignored.
 */
export function parseHooks(
  value: unknown,
): { readonly hooks: readonly HookDefinition[]; readonly problems: readonly string[] } {
  const hooks: HookDefinition[] = [];
  const problems: string[] = [];
  if (value === undefined || value === null) return { hooks, problems };
  if (!Array.isArray(value)) {
    return { hooks, problems: ['hooks must be a list of { event, command } tables'] };
  }

  for (const [index, raw] of value.entries()) {
    const where = `hook #${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(`${where} is not a table`);
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (!isHookEvent(entry['event'])) {
      problems.push(`${where} has no valid event (one of: ${HOOK_EVENTS.join(', ')})`);
      continue;
    }
    const command = entry['command'];
    if (typeof command !== 'string' || !command.trim()) {
      problems.push(`${where} has no command`);
      continue;
    }
    const match = entry['match'];
    if (match !== undefined && typeof match !== 'string') {
      problems.push(`${where} has a non-string match`);
      continue;
    }
    if (typeof match === 'string') {
      try {
        new RegExp(match);
      } catch {
        // A broken pattern is not a "match nothing" default: silently never
        // firing is how someone concludes hooks do not work at all.
        problems.push(`${where} has an invalid match pattern: ${match}`);
        continue;
      }
    }
    const timeout = entry['timeoutMs'];
    hooks.push({
      event: entry['event'],
      command: command.trim(),
      ...(typeof match === 'string' ? { match } : {}),
      ...(typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
        ? { timeoutMs: Math.floor(timeout) }
        : {}),
      ...(typeof entry['name'] === 'string' && entry['name'].trim()
        ? { name: entry['name'].trim() }
        : {}),
    });
  }
  return { hooks, problems };
}

/** Does this hook apply to this event? */
export function hookMatches(hook: HookDefinition, payload: HookEventPayload): boolean {
  if (hook.event !== payload.event) return false;
  if (!hook.match) return true;
  try {
    return new RegExp(hook.match).test(payload.subject ?? '');
  } catch {
    return false;
  }
}

function label(hook: HookDefinition): string {
  return hook.name ?? hook.command.split('\n')[0]!.slice(0, 60);
}

function clip(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CONTEXT_BYTES) return trimmed;
  return `${trimmed.slice(0, MAX_CONTEXT_BYTES)}\n… [hook output truncated]`;
}

export interface HookRunnerOptions {
  readonly container: Container;
  readonly hooks: readonly HookDefinition[];
  /** Absent means no shell is available, and every hook is inert. */
  readonly dialect?: ShellDialect;
  readonly bus?: EventBus;
  readonly signal?: AbortSignal;
}

/**
 * Runs the configured hooks for an event.
 *
 * Hooks for one event run **in sequence**, not in parallel. They are allowed
 * to block, and two hooks racing to block the same tool call have no defined
 * winner; sequence also means a formatter hook and a lint hook see the file in
 * a defined order. The cost is latency on the critical path, which is what the
 * timeout bounds.
 */
export class HookRunner {
  #container: Container;
  #hooks: readonly HookDefinition[];
  #dialect: ShellDialect | undefined;
  #bus: EventBus | undefined;
  #signal: AbortSignal | undefined;

  constructor(options: HookRunnerOptions) {
    this.#container = options.container;
    this.#hooks = options.hooks;
    this.#dialect = options.dialect;
    this.#bus = options.bus;
    this.#signal = options.signal;
  }

  /** True when any hook could fire for this event, so callers can skip the work. */
  has(event: HookEvent): boolean {
    return this.#dialect !== undefined && this.#hooks.some((hook) => hook.event === event);
  }

  async run(payload: HookEventPayload): Promise<HookOutcome> {
    if (!this.#dialect) return EMPTY_OUTCOME;
    const applicable = this.#hooks.filter((hook) => hookMatches(hook, payload));
    if (applicable.length === 0) return EMPTY_OUTCOME;

    const context: string[] = [];
    const failures: { hook: string; detail: string }[] = [];

    for (const hook of applicable) {
      if (this.#signal?.aborted) break;
      const name = label(hook);
      let result;
      try {
        result = await this.#execute(hook, payload);
      } catch (error) {
        // A hook that cannot even be started is a failure, never a block: the
        // action proceeds and the reason is reported.
        failures.push({
          hook: name,
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      this.#bus?.emit('hook.ran', {
        event: payload.event,
        hook: name,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });

      if (result.exitCode === BLOCK_EXIT_CODE) {
        if (payload.event !== 'tool.before') {
          // Only one event has an action left to stop. Elsewhere a 2 is
          // reported rather than pretended to have had an effect.
          failures.push({
            hook: name,
            detail: `exited 2 to block, but ${payload.event} has nothing left to block`,
          });
          continue;
        }
        return {
          blocked: { reason: clip(result.stderr) || `blocked by hook ${name}`, hook: name },
          context,
          failures,
        };
      }

      if (result.exitCode !== 0) {
        failures.push({
          hook: name,
          detail: clip(result.stderr) || `exited ${result.exitCode}`,
        });
        continue;
      }

      const output = clip(result.stdout);
      if (output) context.push(output);
    }

    return { context, failures };
  }

  async #execute(hook: HookDefinition, payload: HookEventPayload) {
    const dialect = this.#dialect;
    if (!dialect) throw new PlifError('INVALID_ARGUMENT', 'no shell dialect for hooks');
    return await this.#container.exec({
      argv: dialect.argv(hook.command),
      timeoutMs: hook.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      // The event reaches the script twice: as variables, which a one-line
      // hook can use without a JSON parser, and as JSON on stdin, which
      // carries the parts that do not fit in a variable.
      env: {
        PLIF_HOOK_EVENT: payload.event,
        ...(payload.subject ? { PLIF_HOOK_SUBJECT: payload.subject } : {}),
      },
      stdin: JSON.stringify({ event: payload.event, subject: payload.subject, data: payload.data ?? {} }),
      reason: `plif hook for ${payload.event}`,
      ...(this.#signal ? { signal: this.#signal } : {}),
    });
  }
}

/**
 * Render a hook outcome for the model.
 *
 * Blocking and advisory output read differently on purpose: a block has to
 * tell the model the action did not happen and why, or it retries the same
 * call; advisory output is just more context.
 */
export function describeHookOutcome(outcome: HookOutcome): string {
  const parts: string[] = [];
  if (outcome.blocked) {
    parts.push(`Blocked by hook "${outcome.blocked.hook}": ${outcome.blocked.reason}`);
    parts.push('The action did not run. Address the reason before trying it again.');
  }
  for (const line of outcome.context) parts.push(line);
  for (const failure of outcome.failures) {
    parts.push(`Hook "${failure.hook}" failed: ${failure.detail}`);
  }
  return parts.join('\n\n');
}
