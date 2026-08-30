import { PlifError } from '../errors.js';
import type { Tool, ToolResult } from './tools.js';

export interface CodeModeLimits {
  readonly sourceBytes: number;
  readonly outputBytes: number;
  readonly timeoutMs: number;
  readonly maxCalls: number;
  readonly maxConcurrency: number;
}

export const DEFAULT_CODE_MODE_LIMITS: CodeModeLimits = {
  sourceBytes: 64 * 1024,
  outputBytes: 32 * 1024,
  timeoutMs: 120_000,
  maxCalls: 64,
  maxConcurrency: 8,
};

export interface CodeModeResult {
  readonly output: string;
  readonly ok: boolean;
  readonly toolCallCount: number;
}

export interface CodeModeOptions {
  readonly source: string;
  readonly tools: ReadonlyMap<string, Tool>;
  readonly call: (name: string, args: Record<string, unknown>, callId: string) => Promise<ToolResult>;
  readonly workflow?: unknown;
  readonly goal?: unknown;
  readonly signal?: AbortSignal;
  readonly limits?: Partial<CodeModeLimits>;
}

/**
 * Code Mode is quarantined until it can execute in a real process/OS security
 * boundary. `node:vm` creates a separate JavaScript context, not a security
 * boundary, and a worker thread still shares the host process privileges.
 *
 * Keep the public function fail-closed so stale callers cannot silently revive
 * the unsafe implementation. `run_script` remains the supported batching path.
 */
export async function runCodeMode(_options: CodeModeOptions): Promise<CodeModeResult> {
  throw new PlifError(
    'POLICY_DENIED',
    'run_code is disabled until Code Mode has a process-isolated runtime',
    { hint: 'Use run_script to batch authorized tool calls.' },
  );
}
