/**
 * The vocabulary Code Mode runs on.
 *
 * Code Mode is the presentation where the model stops calling tools on the
 * wire and starts *writing programs* that call them. One tool, `run_code`,
 * reaches the model; every other tool is reached from inside the program
 * through a generated SDK. The saving is structural rather than cosmetic: a
 * program that reads six files, greps two trees and edits one file is one
 * request and one result, where the native presentation is nine round trips
 * whose intermediate output all lands in the context permanently.
 *
 * The taxonomy below is the part worth getting right. A failed program is
 * information the model can act on, so a failure is a *field* of a resolved
 * result rather than a rejection: the kind says what went wrong, the logs say
 * how far it got, and the next turn fixes the program instead of re-deriving
 * what happened.
 */

/**
 * Why a program stopped, as orthogonal causes that are never merged.
 *
 * Merging any two of these costs the model the one thing it needs to
 * self-correct: `timeout` means the work was too slow, `output-limit` means the
 * work was too loud, and a program that treats them the same retries the wrong
 * fix.
 */
export type CodeRunFailureKind =
  /** The program threw. `message` carries what it threw. */
  | 'exception'
  /** A budget expired: wall clock, or measured busy time. */
  | 'timeout'
  /** The caller cancelled, or the container went down under it. */
  | 'abort'
  /** The runtime process died without reporting: OOM, kill, crash. */
  | 'process-exit'
  /** The runtime reported something that is not a lossless JSON result. */
  | 'invalid-output'
  /** Logs plus result exceeded the byte ceiling. */
  | 'output-limit'
  /** The program asked for more tool calls than the run allows. */
  | 'call-limit'
  /** No process-isolated runtime was available to run it. */
  | 'unavailable';

export interface CodeModeLimits {
  /** Ceiling on the program source itself, before anything is spawned. */
  readonly sourceBytes: number;
  /** Ceiling on logs plus result, measured as UTF-8 bytes. */
  readonly outputBytes: number;
  /** Wall-clock ceiling for the whole run, including time spent in tools. */
  readonly timeoutMs: number;
  /**
   * Ceiling on measured busy time inside the runtime process.
   *
   * Separate from `timeoutMs` on purpose, and the reason both exist: a program
   * waiting on a slow tool is not misbehaving and must not be killed for it,
   * while a program spinning in a hot loop must not be able to hide behind one
   * decoy tool call. Wall clock cannot tell those apart; busy time can.
   */
  readonly computeMs: number;
  /** Ceiling on tool calls dispatched by one program. */
  readonly maxCalls: number;
  /** How many dispatched calls may overlap. */
  readonly maxConcurrency: number;
}

export const DEFAULT_CODE_MODE_LIMITS: CodeModeLimits = Object.freeze({
  sourceBytes: 64 * 1024,
  outputBytes: 32 * 1024,
  timeoutMs: 120_000,
  computeMs: 60_000,
  maxCalls: 64,
  maxConcurrency: 8,
});

/** One tool call a program made, as the transcript and audit log record it. */
export interface CodeDispatchRecord {
  /** `<run call id>:code:<n>` — nested identity that survives into the audit log. */
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly ok: boolean;
  readonly durationMs: number;
  /** Terminal-facing text, already clipped. Never the model's context. */
  readonly output: string;
  readonly diff?: string;
}

export interface CodeRunFailure {
  readonly kind: CodeRunFailureKind;
  readonly message: string;
}

export interface CodeModeResult {
  /** Rendered logs and return value, exactly as the model will read them. */
  readonly output: string;
  readonly ok: boolean;
  readonly toolCallCount: number;
  /** Present when the program did not complete. */
  readonly failure?: CodeRunFailure;
  /** Every sub-call, in submission order, for the interface and the audit log. */
  readonly dispatches: readonly CodeDispatchRecord[];
  /** Isolation the runtime actually got, as the sandbox reported it. */
  readonly isolation?: string;
}

/** How much of the tool surface reaches the wire. */
export type ToolPresentationMode =
  /** Tools on the wire, no `run_code`. The historical behaviour. */
  | 'native'
  /** Only `run_code` on the wire; every other tool is reached from a program. */
  | 'code'
  /** Both, and the model picks. Costs the most tokens; useful while migrating. */
  | 'both';

export function parseToolPresentationMode(value: unknown): ToolPresentationMode | undefined {
  return value === 'native' || value === 'code' || value === 'both' ? value : undefined;
}

export function resolveCodeModeLimits(
  overrides: Partial<CodeModeLimits> | undefined,
): CodeModeLimits {
  if (!overrides) return DEFAULT_CODE_MODE_LIMITS;
  const positive = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  return {
    sourceBytes: positive(overrides.sourceBytes, DEFAULT_CODE_MODE_LIMITS.sourceBytes),
    outputBytes: positive(overrides.outputBytes, DEFAULT_CODE_MODE_LIMITS.outputBytes),
    timeoutMs: positive(overrides.timeoutMs, DEFAULT_CODE_MODE_LIMITS.timeoutMs),
    computeMs: positive(overrides.computeMs, DEFAULT_CODE_MODE_LIMITS.computeMs),
    maxCalls: positive(overrides.maxCalls, DEFAULT_CODE_MODE_LIMITS.maxCalls),
    maxConcurrency: Math.min(
      32,
      positive(overrides.maxConcurrency, DEFAULT_CODE_MODE_LIMITS.maxConcurrency),
    ),
  };
}
