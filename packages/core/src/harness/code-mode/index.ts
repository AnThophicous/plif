/**
 * Code Mode: one tool on the wire, every tool in the program.
 *
 * The model is handed `run_code` and a TypeScript declaration of the whole tool
 * catalogue, and it writes programs instead of issuing calls. Three things
 * follow from that, and they are the reasons the mode exists:
 *
 * - The catalogue leaves the wire. Tool schemas move from a per-request payload
 *   into the cacheable system prefix, so a session with thirty tools stops
 *   paying for thirty schemas on every single request.
 * - The intermediate results leave the context. A program that reads ten files
 *   to return three lines spends three lines of context, not ten files. The
 *   reads are still recorded — for the developer, the timeline and the audit
 *   log — they are simply not spent as tokens.
 * - The round trips collapse. Ten dependent calls are one request and one
 *   result rather than ten of each, and independent calls inside the program
 *   run concurrently under the same rules the native loop already applies.
 *
 * The mode stays fail-closed on the thing that held it back: without a
 * container to spawn a real process in, `run_code` refuses to run rather than
 * quietly falling back to an in-process evaluator, because `node:vm` is a
 * language boundary and a worker thread shares the host's privileges.
 */

import { PlifError } from '../../errors.js';
import type { ToolSpec } from '../../model/provider.js';
import type { Container } from '../../container/container.js';
import type { Tool, ToolResult } from '../tools.js';
import { runCodeProgram } from './runtime.js';
import { RUN_CODE_TOOL_NAME } from './sdk.js';
import type { DispatchOutcome } from './scheduler.js';
import {
  resolveCodeModeLimits,
  type CodeDispatchRecord,
  type CodeModeLimits,
  type CodeModeResult,
} from './types.js';

export { RUN_CODE_TOOL_NAME, CODE_MODE_COLLAPSE_NOTICE, renderToolsSdk } from './sdk.js';
export { DispatchScheduler, DispatchLimitError } from './scheduler.js';
export type { DispatchOutcome } from './scheduler.js';
export { isJsonLossless, decodeInboundFrame, FrameReader } from './protocol.js';
export { runCodeProgram } from './runtime.js';
export {
  DEFAULT_CODE_MODE_LIMITS,
  parseToolPresentationMode,
  resolveCodeModeLimits,
} from './types.js';
export type {
  CodeDispatchRecord,
  CodeModeLimits,
  CodeModeResult,
  CodeRunFailure,
  CodeRunFailureKind,
  ToolPresentationMode,
} from './types.js';

/**
 * The one tool the model sees in code mode.
 *
 * `description` is required and separate from the code because the interface
 * needs a title for the row before the program has produced anything, and a
 * truncated first line of source is not one.
 */
export const RUN_CODE_SPEC: ToolSpec = {
  name: RUN_CODE_TOOL_NAME,
  description:
    'Run a TypeScript program that calls tools. The program body runs in a sandboxed ' +
    'process with a `tools` global declared by the SDK in the system prompt: top-level ' +
    '`await` and `return` both work. Use it for anything past a single call — batch reads, ' +
    'search then read, edit then verify, fan out with Promise.all. Only what you ' +
    '`console.log` and what you `return` enters the conversation, so the program is also ' +
    'how you keep large intermediate output out of the context.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'The body of an async function. Erasable TypeScript syntax only: types are stripped, not checked.',
      },
      description: {
        type: 'string',
        description: 'Five to ten words naming what this program does, for the transcript.',
      },
    },
    required: ['code', 'description'],
    additionalProperties: false,
  },
};

export interface RunCodeToolOptions {
  /**
   * The live registry, read at call time rather than captured.
   *
   * A closure over the map itself would freeze the tool surface at the moment
   * the loop was built, and the surface changes: MCP servers connect, skills
   * register tools, a plan-only turn withdraws mutation. The program must be
   * able to reach exactly what the SDK promised for *this* turn.
   */
  readonly registry: () => ReadonlyMap<string, Tool>;
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) => Promise<DispatchOutcome>;
  readonly container: Container;
  readonly limits?: Partial<CodeModeLimits>;
  /** Sandbox isolation, reported so a weak backend is visible rather than assumed. */
  readonly isolation?: string;
  readonly signal?: AbortSignal;
  readonly onDispatch?: (record: CodeDispatchRecord) => void;
}

export function createRunCodeTool(options: RunCodeToolOptions): Tool {
  const limits = resolveCodeModeLimits(options.limits);
  return {
    spec: RUN_CODE_SPEC,
    async run(input, context): Promise<ToolResult> {
      const code = input['code'];
      const description = input['description'];
      if (typeof code !== 'string' || code.trim().length === 0) {
        throw new PlifError('INVALID_ARGUMENT', 'run_code requires a non-empty "code" program');
      }
      if (typeof description !== 'string' || description.trim().length === 0) {
        throw new PlifError(
          'INVALID_ARGUMENT',
          'run_code requires a short "description" of what the program does',
        );
      }

      const registry = options.registry();
      const result = await runCodeProgram({
        source: code,
        container: options.container,
        toolNames: [...registry.keys()].filter((name) => name !== RUN_CODE_TOOL_NAME),
        limits,
        callIdPrefix: context.callId ?? 'run_code',
        isParallelSafe: (name) => registry.get(name)?.parallelSafe === true,
        dispatch: options.dispatch,
        ...(options.isolation ? { isolation: options.isolation } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onDispatch ? { onDispatch: options.onDispatch } : {}),
      });

      return {
        output: result.output,
        ok: result.ok,
        toolCallCount: result.toolCallCount,
        display: renderTranscript(description.trim(), result),
      };
    },
  };
}

/**
 * What the developer sees, which is not what the model sees.
 *
 * The model gets the program's own output. The terminal gets the shape of the
 * run — which tools it reached, in what order, and whether they worked — because
 * a `run_code` row that showed only a returned string would hide the ten calls
 * that produced it behind a summary the developer cannot audit.
 */
function renderTranscript(description: string, result: CodeModeResult): string {
  const header = `${description} · ${result.toolCallCount} tool call${
    result.toolCallCount === 1 ? '' : 's'
  }${result.isolation ? ` · ${result.isolation} isolation` : ''}`;
  const steps = result.dispatches.map(
    (record, index) =>
      `  ${index + 1}. ${record.ok ? '' : 'FAILED '}${record.name} (${record.durationMs}ms)`,
  );
  return [header, ...steps, '', result.output].join('\n');
}

/**
 * Options kept for callers that predate the tool factory.
 *
 * The shape is unchanged so the fail-closed contract is unchanged with it: a
 * call that supplies no container still refuses, because there is nowhere to
 * run model-written code that is not the host process.
 */
export interface CodeModeOptions {
  readonly source: string;
  readonly tools: ReadonlyMap<string, Tool>;
  readonly call: (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) => Promise<ToolResult>;
  readonly container?: Container;
  readonly callIdPrefix?: string;
  readonly isolation?: string;
  readonly signal?: AbortSignal;
  readonly limits?: Partial<CodeModeLimits>;
  readonly onDispatch?: (record: CodeDispatchRecord) => void;
}

export async function runCodeMode(options: CodeModeOptions): Promise<CodeModeResult> {
  if (!options.container) {
    throw new PlifError(
      'POLICY_DENIED',
      'run_code is disabled until Code Mode has a process-isolated runtime',
      { hint: 'Use run_script to batch authorized tool calls.' },
    );
  }
  return await runCodeProgram({
    source: options.source,
    container: options.container,
    toolNames: [...options.tools.keys()].filter((name) => name !== RUN_CODE_TOOL_NAME),
    limits: resolveCodeModeLimits(options.limits),
    callIdPrefix: options.callIdPrefix ?? 'run_code',
    isParallelSafe: (name) => options.tools.get(name)?.parallelSafe === true,
    dispatch: async (name, args, callId) => {
      const result = await options.call(name, args, callId);
      return {
        ok: result.ok,
        output: result.output,
        ...(result.diff !== undefined ? { diff: result.diff } : {}),
      };
    },
    ...(options.isolation ? { isolation: options.isolation } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onDispatch ? { onDispatch: options.onDispatch } : {}),
  });
}
