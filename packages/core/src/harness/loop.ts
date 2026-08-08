/**
 * The agent loop.
 *
 * Model speaks, tools run, results go back, repeat until the model stops asking
 * for tools. That is four lines of logic; everything else in this file exists
 * because an unsupervised loop over a fallible model needs guard rails, and
 * each guard here is the answer to a specific way loops actually fail:
 *
 * | Failure mode                          | Guard                              |
 * |---------------------------------------|------------------------------------|
 * | never terminates                      | `maxIterations`                    |
 * | repeats the same failing call forever | repetition detector                |
 * | burns the budget on a hopeless path   | consecutive-failure ceiling        |
 * | cannot be stopped                     | one `AbortSignal` through the lot  |
 * | dies on a malformed tool argument     | per-call catch, error back to model|
 * | forgets what it was asked             | the task is pinned, never compacted|
 *
 * The repetition detector is the one worth dwelling on. A model that calls
 * `run_command(["npm","test"])`, sees it fail, and calls it again unchanged has
 * not learned anything from the result — and left alone it will do that until
 * the iteration cap. Detecting the exact repeat and telling it so, in the tool
 * result, converts a silent spin into a prompt to try something else. This is
 * the same principle the learning harness applies across sessions, applied
 * within one.
 */

import { PlifError, toPlifError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import type { Message, ModelProvider, ToolCall } from '../model/provider.js';
import type { Container } from '../container/container.js';
import type { QuestionBroker } from './ask.js';
import { compact, estimateTokens } from './compaction.js';
import type { CompactionResult } from './compaction.js';
import type { MemoryStore } from './memory.js';
import { DEFAULT_TOOLS, toolRegistry, toolSpecs } from './tools.js';
import type { Tool } from './tools.js';
import type { TaskManager } from '../tasks/manager.js';
import type { LspManager } from '../lsp/manager.js';
import type { EditCoordinator } from './edits.js';

export interface LoopOptions {
  readonly provider: ModelProvider;
  readonly container: Container;
  readonly questions: QuestionBroker;
  readonly bus: EventBus;
  readonly tools?: readonly Tool[];
  /**
   * Hard ceiling on passes through the loop.
   *
   * Twenty is generous for real work and still bounded. The cap is a backstop,
   * not a budget — a task that legitimately needs more should be split, and one
   * that hits it by accident was going to spin forever.
   */
  readonly maxIterations?: number;
  /** Give up after this many tool failures in a row. */
  readonly maxConsecutiveFailures?: number;
  readonly signal?: AbortSignal;
  readonly memory?: MemoryStore;
  readonly workspace?: string;
  readonly sessionId?: string;
  readonly contextTokens?: number;
  readonly tasks?: TaskManager;
  readonly lsp?: LspManager;
  readonly edits?: EditCoordinator;
  readonly agentId?: string;
  readonly activateProfile?: (name: string) => Promise<void>;
  /**
   * Anything the human typed since the turn started, taken and cleared.
   *
   * Called at each tool-call boundary, which is the one place in a turn where
   * inserting a message is both free and useful: the model is about to re-read
   * the conversation to interpret the tool results anyway, so a line added
   * there is read in the same pass. Interrupting the stream instead would throw
   * away a turn that was going fine, and waiting until the turn ends would
   * deliver the correction after the work it was meant to redirect.
   *
   * Draining rather than reading is deliberate — the loop takes ownership, so a
   * message cannot be delivered twice if a turn makes several tool calls.
   */
  readonly drainQueue?: () => readonly string[];
}

/**
 * Where compaction kicks in, and therefore what the context gauge measures.
 *
 * Not the model's window — endpoints rarely advertise one, and the number that
 * actually affects the developer is the point at which their conversation gets
 * summarised. A gauge counting toward 200k while compaction fires at 120k
 * would read two thirds full at the moment it happens.
 */
export const DEFAULT_CONTEXT_TOKENS = 120_000;

export type LoopStop =
  /** The model finished and produced an answer. */
  | 'complete'
  | 'max_iterations'
  | 'too_many_failures'
  | 'cancelled'
  | 'error';

export interface LoopResult {
  readonly stop: LoopStop;
  /** Everything the model said, concatenated. */
  readonly text: string;
  /** The full exchange, ready to be appended to the next turn. */
  readonly messages: readonly Message[];
  readonly iterations: number;
  readonly toolCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly error?: PlifError;
}

/** A fingerprint for "the model just did exactly this". */
function callSignature(call: ToolCall): string {
  return `${call.name}(${call.arguments})`;
}

export interface CompactionRun {
  readonly provider?: ModelProvider;
  readonly bus: EventBus;
  /** Token count to get under. */
  readonly target: number;
  readonly signal?: AbortSignal;
}

/**
 * Compact, and narrate it.
 *
 * Shared by the loop's automatic pass and by `/compact`, so a conversation
 * shrunk on purpose behaves exactly like one shrunk because it had to — same
 * ladder, same events, same summary pinned into the history. A second
 * implementation for the manual path is how the two quietly drift apart.
 */
export async function runCompaction(
  messages: readonly Message[],
  run: CompactionRun,
): Promise<CompactionResult> {
  const result = await compact(messages, {
    maxTokens: run.target,
    ...(run.provider ? { provider: run.provider } : {}),
    ...(run.signal ? { signal: run.signal } : {}),
    onStage: (stage, step, steps) => {
      run.bus.emit('agent.compacting', {
        stage,
        step,
        steps,
        before: estimateTokens(messages),
        target: run.target,
      });
    },
  });

  run.bus.emit('agent.compacted', {
    before: result.before,
    after: result.after,
    stages: result.stages,
    summarised: result.summary !== null,
  });

  return result;
}

export async function runLoop(
  history: readonly Message[],
  options: LoopOptions,
): Promise<LoopResult> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const registry = toolRegistry(tools);
  const specs = toolSpecs(tools);
  // A model/tool mistake is recoverable work, not a reason to kill the task.
  // Keep an explicit cap for embedders that need one, but interactive Plif
  // sessions are uncapped and end through completion, cancellation, or a
  // structural error.
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
  const maxFailures = options.maxConsecutiveFailures ?? 4;
  const contextTokens = options.contextTokens ?? 0;

  const messages: Message[] = [...history];
  const recentCalls: string[] = [];

  let text = '';
  let iterations = 0;
  let toolCalls = 0;
  let consecutiveFailures = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let qualityDirty = false;
  let qualityEvidence = false;
  let qualityReminders = 0;
  /** Sticky: thinking mode, once entered, applies to the whole conversation. */
  let sawReasoning = false;

  while (iterations < maxIterations) {
    if (options.signal?.aborted) {
      return done('cancelled');
    }
    iterations += 1;
    options.bus.emit('agent.turn', { iteration: iterations, maxIterations });

    if (contextTokens > 0 && estimateTokens(messages) > contextTokens) {
      const compacted = await runCompaction(messages, {
        provider: options.provider,
        bus: options.bus,
        target: Math.floor(contextTokens * 0.7),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      messages.length = 0;
      messages.push(...compacted.messages);
    }

    // --- ask the model ---------------------------------------------------
    let turnText = '';
    let turnReasoning = '';
    const requested: ToolCall[] = [];
    /** When the current thinking block opened, or null when not thinking. */
    let thinkingSince: number | null = null;

    /**
     * Close the thinking block, if one is open.
     *
     * Called when the model starts talking instead and again at the end of the
     * stream. Both matter: a model that thinks and then answers ends the block
     * at the first word, and one that thinks and then calls a tool without
     * saying anything ends it when the stream does.
     */
    const endThinking = (): void => {
      if (thinkingSince === null) return;
      options.bus.emit('agent.thinking', {
        phase: 'end',
        durationMs: Date.now() - thinkingSince,
      });
      thinkingSince = null;
    };

    try {
      for await (const event of options.provider.stream({
        messages,
        tools: specs,
        ...(options.signal ? { signal: options.signal } : {}),
      })) {
        if (event.kind === 'text') {
          endThinking();
          turnText += event.delta;
          options.bus.emit('agent.text', { delta: event.delta });
        } else if (event.kind === 'reasoning') {
          // Kept, not just shown. It has to go back on the wire next turn or a
          // reasoning model refuses the follow-up request outright.
          if (thinkingSince === null) {
            thinkingSince = Date.now();
            options.bus.emit('agent.thinking', { phase: 'start' });
          }
          turnReasoning += event.delta;
          options.bus.emit('agent.reasoning', { delta: event.delta });
        } else if (event.kind === 'tool') {
          requested.push(event.call);
        } else if (event.kind === 'retry') {
          options.bus.emit('agent.retry', {
            attempt: event.attempt,
            of: event.of,
            waitMs: event.waitMs,
            reason: event.reason,
          });
        } else if (event.kind === 'reset') {
          // The provider is redoing the turn. Anything already accumulated
          // belongs to the attempt being abandoned, and keeping it would send
          // the model two halves of two different answers as its own.
          endThinking();
          turnText = '';
          turnReasoning = '';
          requested.length = 0;
          options.bus.emit('agent.reset', { reason: 'the endpoint failed part-way through' });
        } else {
          promptTokens += event.usage.promptTokens;
          completionTokens += event.usage.completionTokens;
          // Not every endpoint fills in usage. Counting the messages ourselves
          // is worse than the real number and far better than a gauge that
          // reads zero for the whole session, which is indistinguishable from
          // a broken one.
          const reported = event.usage.promptTokens > 0;
          options.bus.emit('agent.usage', {
            promptTokens: reported ? event.usage.promptTokens : estimateTokens(messages),
            completionTokens: event.usage.completionTokens,
            budget: contextTokens,
            estimated: !reported,
          });
          if (event.reason === 'cancelled') {
            endThinking();
            text += turnText;
            return done('cancelled');
          }
        }
      }
      endThinking();
    } catch (error) {
      endThinking();
      return done('error', toPlifError(error, 'MODEL_ERROR'));
    }

    text += turnText;
    // Once a model has shown reasoning it is in thinking mode for the rest of
    // the conversation, and every later assistant turn must carry the field —
    // empty string included — or the provider can reject the next request.
    if (turnReasoning) sawReasoning = true;
    messages.push({
      role: 'assistant',
      content: turnText,
      ...(sawReasoning ? { reasoning: turnReasoning } : {}),
      ...(requested.length ? { toolCalls: requested } : {}),
    });

    // No tools requested means the model considers itself finished.
    if (requested.length === 0) {
      if (qualityDirty && !qualityEvidence && qualityReminders < 2) {
        qualityReminders += 1;
        messages.push({
          role: 'user',
          content:
            'Validation gate: you changed code but did not provide verification evidence. ' +
            'Run diagnostics for changed files when an LSP is available, then run the ' +
            'relevant typecheck/build/tests and inspect their results before concluding.',
        });
        continue;
      }
      return done('complete');
    }

    // --- run the tools ---------------------------------------------------
    //
    // Consecutive parallel-safe calls go out together; anything else runs on
    // its own. Batching rather than "all at once" is what keeps the semantics
    // the model expects: it can read six files in one round trip, but a write
    // followed by a read of the same path still happens in that order, because
    // the write breaks the batch.
    for (const batch of scheduleBatches(requested, registry)) {
      if (options.signal?.aborted) return done('cancelled');

      const prepared = batch.map((call) => prepare(call, recentCalls, registry));
      toolCalls += prepared.length;

      for (const item of prepared) {
        options.bus.emit('agent.tool', {
          id: item.call.id,
          name: item.call.name,
          input: item.parseError ? item.call.arguments : item.parsed,
          phase: 'start',
        });
      }

      const settled = await Promise.all(
        prepared.map(async (item) => {
          const started = Date.now();
          const result =
            item.refusal !== null
              ? { output: item.refusal, ok: false }
              : await executeCall({
                  call: item.call,
                  parsed: item.parsed,
                  parseError: item.parseError,
                  registry,
                  options,
                });
          return { ...item, ...result, durationMs: Date.now() - started };
        }),
      );

      for (const item of settled) {
        if (item.ok) consecutiveFailures = 0;
        else consecutiveFailures += 1;

        await recordStrategy(options, item.call, item.parsed, item.ok, item.durationMs);

        options.bus.emit('agent.tool', {
          id: item.call.id,
          name: item.call.name,
          input: item.parsed,
          phase: 'end',
          ok: item.ok,
          durationMs: item.durationMs,
          output: item.output,
          ...(item.diff ? { diff: item.diff } : {}),
        });

        messages.push({ role: 'tool', content: item.output, toolCallId: item.call.id });
        if (item.call.name === 'write_file') {
          qualityDirty = true;
          qualityEvidence = false;
        }
        const validationCommand = item.call.name === 'run_command' &&
          /(?:test|typecheck|build|check|lint|verify)/i.test(String(item.parsed['argv'] ?? ''));
        if (item.ok && (item.call.name === 'diagnostics' || validationCommand)) {
          qualityEvidence = true;
        }
      }

      // The human said something while this was running. It goes in after the
      // tool results and before the model's next turn, so the very next thing
      // it reads is the correction rather than finding out at the end.
      const queued = options.drainQueue?.() ?? [];
      for (const text of queued) {
        messages.push({
          role: 'user',
          content:
            `[sent while you were working, read this before continuing]\n${text}`,
        });
      }
      if (queued.length > 0) {
        options.bus.emit('agent.dequeued', { count: queued.length });
      }

      if (consecutiveFailures >= maxFailures) {
        messages.push({
          role: 'user',
          content:
            `Recovery checkpoint: ${consecutiveFailures} tool calls failed in a row. ` +
            'Do not stop the task. Diagnose the latest error, change the command or ' +
            'strategy materially, and continue. If Bash syntax is uncertain, use a ' +
            'minimal command or repository search instead of repeating the same call.',
        });
        consecutiveFailures = 0;
      }
    }
  }

  return done('max_iterations');

  function done(stop: LoopStop, error?: PlifError): LoopResult {
    return {
      stop,
      text,
      messages,
      iterations,
      toolCalls,
      promptTokens,
      completionTokens,
      ...(error ? { error } : {}),
    };
  }
}

/** How many recent calls the repetition detector remembers. */
const REPEAT_WINDOW = 6;

/**
 * Group the requested calls into rounds that may run together.
 *
 * Order is preserved: a batch only ever grows by absorbing the *next* call, and
 * a call that is not parallel-safe both ends the batch before it and forms one
 * of its own. So `[read, read, write, read]` runs as `[read, read]`, `[write]`,
 * `[read]` — three round trips instead of four, with the write still landing
 * between the reads that surround it.
 */
export function scheduleBatches(
  calls: readonly ToolCall[],
  registry: Map<string, Tool>,
): ToolCall[][] {
  const batches: ToolCall[][] = [];
  for (const call of calls) {
    const safe = registry.get(call.name)?.parallelSafe === true;
    const open = batches[batches.length - 1];
    if (safe && open && registry.get(open[0]!.name)?.parallelSafe === true) open.push(call);
    else batches.push([call]);
  }
  return batches;
}

interface PreparedCall {
  readonly call: ToolCall;
  readonly parsed: Record<string, unknown>;
  readonly parseError: string | null;
  /** Set when the repetition guard is refusing this call outright. */
  readonly refusal: string | null;
}

/**
 * Parse the arguments and apply the repetition guard, before anything runs.
 *
 * Done up front, and sequentially, because the guard is stateful: two identical
 * calls inside one parallel batch must not both pass just because they were
 * checked at the same instant.
 */
function prepare(
  call: ToolCall,
  recentCalls: string[],
  registry: Map<string, Tool>,
): PreparedCall {
  let parsed: Record<string, unknown> = {};
  let parseError: string | null = null;

  try {
    parsed = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
  } catch {
    // Hand the malformed JSON straight back rather than throwing. Models
    // recover from this reliably when told; killing the loop over it wastes
    // everything done so far.
    parseError = `arguments were not valid JSON: ${call.arguments}`;
  }

  if (parseError) return { call, parsed, parseError, refusal: null };

  // A tool that declares itself repeatable is exempt. Polling is the whole
  // reason: `task_status` on a running job is meant to be asked again, and
  // refusing it left the model unable to watch a task it had just started.
  const repeatable = registry.get(call.name)?.repeatable === true;
  const signature = callSignature(call);
  if (!repeatable && recentCalls.includes(signature)) {
    return {
      call,
      parsed,
      parseError,
      refusal:
        `Error: you already called ${call.name} with exactly these arguments in this turn, ` +
        'and the result has not changed. Repeating it will not help. Either use what the ' +
        'previous result told you, or try a materially different approach.',
    };
  }

  if (!repeatable) {
    recentCalls.push(signature);
    if (recentCalls.length > REPEAT_WINDOW) recentCalls.shift();
  }

  return { call, parsed, parseError, refusal: null };
}

/**
 * Feed the outcome back into the learning harness.
 *
 * Only `run_command` is recorded. A file read that worked proves nothing about
 * how this project is built, but "`npm test` succeeds here" is exactly the kind
 * of claim that should have to earn its confidence across sessions.
 *
 * Context is kept low-cardinality on purpose. Putting a timestamp or a file
 * hash in here would make every situation unique, so nothing would ever count
 * as an independent repeat and the ladder would never leave `candidate`.
 */
async function recordStrategy(
  options: LoopOptions,
  call: ToolCall,
  parsed: Record<string, unknown>,
  ok: boolean,
  durationMs: number,
): Promise<void> {
  if (!options.memory || !options.workspace || call.name !== 'run_command') return;

  const argv = Array.isArray(parsed['argv']) ? (parsed['argv'] as string[]) : [];
  if (argv.length === 0) return;

  await options.memory
    .recordOutcome({
      workspace: options.workspace,
      goal: argv[0] as string,
      approach: argv.join(' '),
      ok,
      context: {
        os: process.platform,
        command: argv[0] as string,
        container: options.container.name,
      },
      sessionId: options.sessionId ?? 'unknown',
      durationMs,
    })
    .catch(() => undefined);
}

async function executeCall(input: {
  call: ToolCall;
  parsed: Record<string, unknown>;
  parseError: string | null;
  registry: Map<string, Tool>;
  options: LoopOptions;
}): Promise<{ output: string; ok: boolean; diff?: string }> {
  const { call, parsed, parseError, registry, options } = input;

  if (parseError) return { output: `Error: ${parseError}`, ok: false };

  const tool = registry.get(call.name);
  if (!tool) {
    return {
      output: `Error: no tool named "${call.name}". Available: ${[...registry.keys()].join(', ')}`,
      ok: false,
    };
  }

  try {
    return await tool.run(parsed, {
      container: options.container,
      questions: options.questions,
      signal: options.signal,
      bus: options.bus,
      callId: call.id,
      ...(options.memory ? { memory: options.memory } : {}),
      ...(options.workspace ? { workspace: options.workspace } : {}),
      ...(options.tasks ? { tasks: options.tasks } : {}),
      ...(options.lsp ? { lsp: options.lsp } : {}),
      ...(options.edits ? { edits: options.edits } : {}),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.activateProfile ? { activateProfile: options.activateProfile } : {}),
    });
  } catch (error) {
    // A denied action, a bad path, a blown quota — all of these are information
    // the model can act on, so they go back as a tool result rather than
    // unwinding the loop. Only a model-transport failure ends the run.
    const plif = toPlifError(error);
    const hint = plif.hint ? ` (${plif.hint})` : '';
    return { output: `Error: ${plif.message}${hint}`, ok: false };
  }
}
