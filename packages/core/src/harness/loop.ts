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

import { randomUUID } from 'node:crypto';

import { PlifError, toPlifError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import { safeToolCallArguments } from '../model/provider.js';
import type { Message, ModelProvider, ToolCall } from '../model/provider.js';
import type { Attachment } from '../model/provider.js';
import type { Container } from '../container/container.js';
import type { QuestionBroker } from './ask.js';
import { compact, estimateTokens } from './compaction.js';
import type { CompactionResult } from './compaction.js';
import { computeContextBudget, stableToolSpecs } from './context-budget.js';
import type { ContextBudget } from './context-budget.js';
import {
  appendTokenSplitMetric,
  makeTokenSplitMetric,
  projectTokenSplitInput,
  spillToolOutput,
  techniqueIsOn,
  writeStateNotes,
} from './token-split/index.js';
import type {
  TokenSplitConfig,
  TokenSplitProjection,
  TokenSplitTransformation,
} from './token-split/index.js';
import {
  canonicalFromLegacyUsage,
  estimatedTokenUsage,
  mergeTokenUsage,
} from '../model/token-usage.js';
import type { CanonicalTokenUsage } from '../model/token-usage.js';
import type { MemoryStore } from './memory.js';
import {
  DEFAULT_TOOLS,
  toolRegistry,
  toolSpecs,
  toolsForEnvironment,
} from './tools.js';
import type { Tool, ToolResult } from './tools.js';
import type { ShellDialect } from '../execution/shell-dialects.js';
import type { TaskManager } from '../tasks/manager.js';
import type { LspManager } from '../lsp/manager.js';
import type { EditCoordinator } from './edits.js';
import { eventBase } from '../session/events.js';
import {
  createHarnessCycle,
  inspectionPaths,
  isFileMutationTool,
  isShellMutation,
  isValidationObservation,
  mutationGate,
  mutationPaths,
  observeHarnessCycle,
  reviewGate,
} from './cycle.js';

export interface LoopOptions {
  readonly provider: ModelProvider;
  readonly container: Container;
  readonly questions: QuestionBroker;
  readonly bus: EventBus;
  /** Stable identity shared by every durable event emitted during this run. */
  readonly turnId?: string;
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
  /** Stop with an error instead of completing after this many unanswered review gates. */
  readonly maxReviewReminders?: number;
  /** Enable the durable plan/review cycle for the selected effort only. */
  readonly enableHarnessCycle?: boolean;
  readonly signal?: AbortSignal;
  readonly memory?: MemoryStore;
  readonly workspace?: string;
  readonly sessionId?: string;
  readonly contextTokens?: number;
  /** Output reservation used by the context budget engine. */
  readonly reservedOutputTokens?: number;
  /** Safety margin kept below the provider's advertised context window. */
  readonly safetyMarginTokens?: number;
  readonly tasks?: TaskManager;
  readonly lsp?: LspManager;
  readonly edits?: EditCoordinator;
  readonly agentId?: string;
  /** Optional request projection and metrics for the Token Split engine. */
  readonly tokenSplit?: {
    readonly config: TokenSplitConfig;
    readonly workspace?: string;
    readonly sessionId?: string;
  };
  /** Resolved once for the session and shared by tool registration and calls. */
  readonly shellDialect?: ShellDialect;
  readonly activateProfile?: (name: string) => Promise<void>;
  readonly setGoal?: (condition: string) => Promise<void>;
  readonly attachments?: readonly Attachment[];
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
  readonly drainQueue?: () => Promise<readonly (Message | string)[]> | readonly (Message | string)[];
}

const VISIBLE_TOOL_OUTPUT = new Set([
  'run_command',
  'shell_command',
  'write_file',
  'edit_file',
  'list_dir',
  'web_search',
  'research',
]);

/** Separate model context from terminal transcript without weakening either one. */
export function terminalToolOutput(
  name: string,
  result: Pick<ToolResult, 'output' | 'display' | 'ok'>,
): string {
  const full = result.display ?? result.output;
  if (VISIBLE_TOOL_OUTPUT.has(name)) return full;
  if (result.ok) return '';
  return full.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 500) ?? '';
}

/**
 * Fallback context window for endpoints and custom models that do not declare
 * one. A provider-advertised window always wins so the gauge and auto-compaction
 * threshold describe the model actually serving the turn.
 */
export const DEFAULT_CONTEXT_TOKENS = 1_000_000;
export const AUTO_COMPACTION_TRIGGER_RATIO = 0.9;
export const AUTO_COMPACTION_TARGET_RATIO = 0.5;

/** Below this, a loop pass was too quick to be a moment worth marking. */
export const CYCLE_SEPARATOR_MIN_MS = 10_000;
// One combined checkpoint plus one follow-up is enough to recover a model that
// missed part of the evidence. A third reminder only elongates the session and
// repeats the same instruction without improving the proof.
const DEFAULT_MAX_REVIEW_REMINDERS = 2;

export function shouldAutoCompact(used: number, contextTokens: number): boolean {
  return contextTokens > 0 && used >= Math.floor(contextTokens * AUTO_COMPACTION_TRIGGER_RATIO);
}

export function autoCompactionTarget(contextTokens: number): number {
  return Math.floor(contextTokens * AUTO_COMPACTION_TARGET_RATIO);
}

const DANGLING_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'is', 'of',
  'on', 'or', 'so', 'than', 'that', 'the', 'then', 'this', 'to', 'was', 'were', 'will', 'with',
  'à', 'ao', 'aos', 'antes', 'até', 'com', 'como', 'da', 'das', 'de', 'depois', 'do',
  'dos', 'e', 'em', 'entre', 'está', 'estão', 'é', 'já', 'mais', 'mas', 'muito', 'na', 'nas',
  'no', 'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelo', 'por', 'que', 'quando', 'se', 'sem',
  'sobre', 'são', 'também', 'um', 'uma', 'umas', 'uns', 'às',
]);

const SENTENCE_END = /[.!?:;,)\]}"'`>»…]$/;
const LAST_WORD = /([\p{L}\p{N}'’-]+)$/u;
const SENTENCE_SPLIT = /[.!?:;\n]/g;
const SHEARED_SENTENCE = 40;

export function endsMidSentence(text: string): boolean {
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed.length < 8 || SENTENCE_END.test(trimmed)) return false;

  const last = LAST_WORD.exec(trimmed)?.[1];
  if (last !== undefined && DANGLING_WORDS.has(last.toLowerCase())) return true;

  let start = 0;
  for (const match of trimmed.matchAll(SENTENCE_SPLIT)) start = match.index + 1;
  return trimmed.length - start >= SHEARED_SENTENCE;
}

/**
 * Prose that arrives before a tool request is operational, not a conclusion.
 * A clipped fragment is hidden from the developer-facing answer while the raw
 * assistant message remains in protocol history for the tool follow-up.
 */
export function classifyPreToolProse(
  text: string,
  requestedTools: number,
): 'transient' | 'activity' | null {
  const normalized = text.trim();
  if (!normalized || requestedTools === 0) return null;
  return endsMidSentence(normalized) ? 'transient' : 'activity';
}

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
  readonly retries: number;
  readonly tokenUsage?: CanonicalTokenUsage;
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
    removedTokens: Math.max(0, result.before - result.after),
    progressed: result.progressed,
    stages: result.stages,
    summarised: result.summary !== null,
    ...(result.failure ? { failure: result.failure } : {}),
  });

  return result;
}

export async function runLoop(
  history: readonly Message[],
  options: LoopOptions,
): Promise<LoopResult> {
  const turnId = options.turnId ?? randomUUID();
  const loopStartedAt = Date.now();
  const tools = options.tools ?? (
    options.shellDialect
      ? toolsForEnvironment({ dialect: options.shellDialect, reason: null })
      : DEFAULT_TOOLS
  );
  const registry = toolRegistry(tools);
  const specs = stableToolSpecs(toolSpecs(tools));
  // The review cycle is a PLIF policy, not a property of having mutation tools.
  // Keeping it opt-in prevents ordinary efforts from gaining hidden model turns.
  const cycleEnabled = options.enableHarnessCycle === true &&
    registry.has('update_plan') && [...registry.keys()].some((name) =>
      isFileMutationTool(name) || name === 'run_command' || name === 'shell_command'
    );
  // A model/tool mistake is recoverable work, not a reason to kill the task.
  // Keep an explicit cap for embedders that need one, but interactive Plif
  // sessions are uncapped and end through completion, cancellation, or a
  // structural error.
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
  const maxFailures = options.maxConsecutiveFailures ?? 4;
  const maxReviewReminders = Math.max(
    0,
    options.maxReviewReminders ?? DEFAULT_MAX_REVIEW_REMINDERS,
  );
  const contextTokens =
    options.contextTokens ?? options.provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS;

  const messages: Message[] = [...history];
  const tokenSplitConfig = options.tokenSplit?.config;
  const tokenSplitTransformations: TokenSplitTransformation[] = [];
  const recentCalls: string[] = [];

  const persistTokenSplitNotes = async (): Promise<void> => {
    if (!tokenSplitConfig || !options.tokenSplit?.workspace || !options.tokenSplit.sessionId) return;
    if (!techniqueIsOn(tokenSplitConfig, 'state-notes')) return;
    await writeStateNotes(
      options.tokenSplit.workspace,
      options.tokenSplit.sessionId,
      messages,
      iterations,
    ).catch(() => undefined);
  };

  let text = '';
  let iterations = 0;
  let toolCalls = 0;
  let consecutiveFailures = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let retries = 0;
  let tokenUsage: CanonicalTokenUsage | undefined;
  let cycle = createHarnessCycle();
  let reviewReminders = 0;
  // A failed capsule provider is disabled for the rest of this loop. Later
  // passes may still apply cheap mechanical trimming, but must not hammer an
  // endpoint that just failed auth, quota, transport, or protocol validation.
  let compactionProviderAvailable = true;
  /** Sticky: thinking mode, once entered, applies to the whole conversation. */
  let sawReasoning = false;

  const setCycle = (
    next: typeof cycle,
    reason: 'turn_started' | 'plan_ready' | 'change_applied' | 'review_required' | 'completed',
  ): void => {
    const changed = next.phase !== cycle.phase;
    cycle = next;
    if (cycleEnabled && changed) options.bus.emit('agent.phase', { phase: cycle.phase, reason });
  };

  if (cycleEnabled) options.bus.emit('agent.phase', { phase: cycle.phase, reason: 'turn_started' });

  while (iterations < maxIterations) {
    if (options.signal?.aborted) {
      return done('cancelled');
    }
    iterations += 1;
    options.bus.emit('agent.turn', { iteration: iterations, maxIterations });

    let projection: TokenSplitProjection | null = tokenSplitConfig
      ? projectTokenSplitInput(messages, tokenSplitConfig)
      : null;
    let budget = computeContextBudget({
      contextWindow: contextTokens,
      messages: projection?.messages ?? messages,
      tools: specs,
      appendOnly: projection === null,
      reservedOutputTokens: options.reservedOutputTokens ?? options.provider.info.maxOutputTokens,
      ...(options.safetyMarginTokens === undefined ? {} : { safetyMarginTokens: options.safetyMarginTokens }),
    });
    emitContextBudget(budget);
    const compactionBudget = budget.availableInputBudget ?? contextTokens;
    if (shouldAutoCompact(budget.effectiveInputTokens, compactionBudget)) {
      const compacted = await runCompaction(messages, {
        ...(compactionProviderAvailable ? { provider: options.provider } : {}),
        bus: options.bus,
        target: Math.min(autoCompactionTarget(contextTokens), autoCompactionTarget(compactionBudget)),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      messages.length = 0;
      messages.push(...compacted.messages);
      if (compacted.failure) compactionProviderAvailable = false;
      const afterBudget = computeContextBudget({
        contextWindow: contextTokens,
        messages,
        tools: specs,
        appendOnly: false,
        reservedOutputTokens: options.reservedOutputTokens ?? options.provider.info.maxOutputTokens,
        ...(options.safetyMarginTokens === undefined ? {} : { safetyMarginTokens: options.safetyMarginTokens }),
      });
      projection = tokenSplitConfig ? projectTokenSplitInput(messages, tokenSplitConfig) : null;
      budget = computeContextBudget({
        contextWindow: contextTokens,
        messages: projection?.messages ?? messages,
        tools: specs,
        appendOnly: false,
        reservedOutputTokens: options.reservedOutputTokens ?? options.provider.info.maxOutputTokens,
        ...(options.safetyMarginTokens === undefined ? {} : { safetyMarginTokens: options.safetyMarginTokens }),
      });
      if (!compacted.progressed && afterBudget.pressure === 'critical') {
        return done('error', new PlifError(
          'MODEL_ERROR',
          `Context compaction made no progress (${afterBudget.effectiveInputTokens} tokens remain for a ${afterBudget.availableInputBudget ?? contextTokens}-token input budget).`,
          { hint: 'Reduce tool output or start a fresh session.' },
        ));
      }
    }

    const turnStartedAt = Date.now();

    // --- ask the model ---------------------------------------------------
    let turnText = '';
    let turnReasoning = '';
    let turnPromptTokens = 0;
    let turnCompletionTokens = 0;
    let turnCacheHitTokens: number | undefined;
    let turnCacheMissTokens: number | undefined;
    const requested: ToolCall[] = [];
    /** When the current thinking block opened, or null when not thinking. */
    let thinkingSince: number | null = null;

    /**
     * Add this turn's prose to the answer, as its own paragraph.
     *
     * The separator is the point. Each turn is a separate utterance with a tool
     * call between it and the next, so concatenating them bare runs the last
     * word of one into the first word of the next — and the join is invisible,
     * so the transcript reads as one mangled sentence rather than two whole
     * ones. That text is recorded to the session and replayed on resume, so the
     * damage outlives the turn.
     */
    const keepTurnText = (): void => {
      if (!turnText) return;
      text = text ? `${text}\n\n${turnText}` : turnText;
    };

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
        turnId,
        phase: 'end',
        durationMs: Date.now() - thinkingSince,
      });
      thinkingSince = null;
    };

    try {
      for await (const event of options.provider.stream({
        messages: projection?.messages ?? messages,
        tools: specs,
        ...(options.signal ? { signal: options.signal } : {}),
      })) {
        if (event.kind === 'text') {
          endThinking();
          turnText += event.delta;
          options.bus.emit('agent.text', { turnId, delta: event.delta });
        } else if (event.kind === 'reasoning') {
          // Kept, not just shown. It has to go back on the wire next turn or a
          // reasoning model refuses the follow-up request outright.
          if (thinkingSince === null) {
            thinkingSince = Date.now();
            options.bus.emit('agent.thinking', { turnId, phase: 'start' });
          }
          turnReasoning += event.delta;
          options.bus.emit('agent.reasoning', { turnId, delta: event.delta });
        } else if (event.kind === 'tool') {
          requested.push(event.call);
        } else if (event.kind === 'retry') {
          retries += 1;
          options.bus.emit('agent.retry', {
            turnId,
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
          options.bus.emit('agent.reset', { turnId, reason: 'the endpoint failed part-way through' });
        } else {
          turnPromptTokens += event.usage.promptTokens;
          turnCompletionTokens += event.usage.completionTokens;
          promptTokens += event.usage.promptTokens;
          completionTokens += event.usage.completionTokens;
          const reported = event.usage.tokenUsage?.totalPromptTokens !== undefined || event.usage.promptTokens > 0;
          const currentUsage = event.usage.tokenUsage ?? (reported
            ? canonicalFromLegacyUsage(event.usage.promptTokens, event.usage.completionTokens)
            : estimatedTokenUsage(estimateTokens(messages), event.usage.completionTokens));
          tokenUsage = mergeTokenUsage(tokenUsage, currentUsage);
          if (currentUsage.source !== 'estimated' && currentUsage.source !== 'unknown') {
            if (currentUsage.inputCachedTokens !== undefined) turnCacheHitTokens = (turnCacheHitTokens ?? 0) + currentUsage.inputCachedTokens;
            if (currentUsage.inputNewTokens !== undefined) turnCacheMissTokens = (turnCacheMissTokens ?? 0) + currentUsage.inputNewTokens;
          }
          // Not every endpoint fills in usage. Counting the messages ourselves
          // is worse than the real number and far better than a gauge that
          // reads zero for the whole session, which is indistinguishable from
          // a broken one.
          options.bus.emit('agent.usage', {
            turnId,
            promptTokens: reported ? event.usage.promptTokens : estimateTokens(messages),
            // Cumulative for this user turn. A tool-using turn may make
            // several provider requests, and the TUI must not reset its meter
            // at every tool boundary.
            completionTokens,
            budget: contextTokens,
            estimated: !reported,
            inputNewTokens: tokenUsage.inputNewTokens,
            inputCachedTokens: tokenUsage.inputCachedTokens,
            cacheWriteTokens: tokenUsage.cacheWriteTokens,
            reasoningTokens: tokenUsage.reasoningTokens,
            totalTokens: tokenUsage.totalTokens,
            requestCount: tokenUsage.requestCount,
            source: tokenUsage.source,
          });
          if (event.reason === 'cancelled') {
            endThinking();
            keepTurnText();
            return done('cancelled');
          }
        }
      }
      endThinking();
      if (tokenSplitConfig && projection && options.tokenSplit?.workspace) {
        const metric = makeTokenSplitMetric(
          iterations,
          projection.baselineTokens,
          projection.effectiveTokens,
          turnCompletionTokens,
          budget.pressure,
          [...projection.transformations, ...tokenSplitTransformations],
          tokenSplitConfig,
          turnPromptTokens,
          { hit: turnCacheHitTokens, miss: turnCacheMissTokens },
        );
        await appendTokenSplitMetric(
          options.tokenSplit.workspace,
          options.tokenSplit.sessionId ?? 'interactive',
          metric,
        ).catch(() => undefined);
      }
    } catch (error) {
      endThinking();
      // A provider can fail after delivering useful prose. Preserve that
      // partial turn before the terminal failure event so the UI and session
      // history never collapse a generated response into only a duration.
      if (turnText || turnReasoning) {
        keepTurnText();
        options.bus.emit('conversation.event', {
          ...eventBase('assistant.message', turnId),
          phase: 'commentary',
          text: turnText,
          ...(turnReasoning ? { reasoning: turnReasoning } : {}),
        });
      }
      return done('error', toPlifError(error, 'MODEL_ERROR'));
    }

    const preToolProse = classifyPreToolProse(turnText, requested.length);
    if (preToolProse) {
      // PLIF is the inspectable effort: intermediate prose is part of the
      // visible reasoning record, not disposable chatter before a tool call.
      // Other efforts retain the quieter transient/activity policy.
      const visibility = options.enableHarnessCycle ? 'activity' : preToolProse;
      options.bus.emit('agent.pre_tool_prose', {
        turnId,
        iteration: iterations,
        text: turnText,
        visibility,
      });
    }

    if (preToolProse === null) keepTurnText();
    // Once a model has shown reasoning it is in thinking mode for the rest of
    // the conversation, and every later assistant turn must carry the field —
    // empty string included — or the provider can reject the next request.
    if (turnReasoning) sawReasoning = true;
    const protocolToolCalls = requested.map((call) => ({
      ...call,
      arguments: safeToolCallArguments(call.arguments),
    }));
    messages.push({
      role: 'assistant',
      content: turnText,
      ...(sawReasoning ? { reasoning: turnReasoning } : {}),
      ...(requested.length
        ? {
            // Keep the raw call in `requested` for the local parse error, but
            // never replay malformed JSON as assistant history.
            toolCalls: protocolToolCalls,
          }
        : {}),
    });
    options.bus.emit('conversation.event', {
      ...eventBase('assistant.message', turnId),
      phase: requested.length > 0 ? 'commentary' : 'final',
      text: turnText,
      ...(sawReasoning ? { reasoning: turnReasoning } : {}),
      ...(protocolToolCalls.length > 0 ? { toolCalls: protocolToolCalls } : {}),
    });
    await persistTokenSplitNotes();

    // No tools requested means the model considers itself finished.
    if (requested.length === 0) {
      if (cycleEnabled) {
        setCycle(
          observeHarnessCycle(cycle, { type: 'review_requested' }),
          'review_required',
        );
        const gate = reviewGate(cycle);
        if (gate !== null) {
          reviewReminders += 1;
          if (reviewReminders > maxReviewReminders) {
            return done(
              'error',
              new PlifError('INTERNAL', 'The review gate was not satisfied before completion.', {
                hint: gate,
              }),
            );
          }
          messages.push({ role: 'user', content: gate });
          continue;
        }
        setCycle(observeHarnessCycle(cycle, { type: 'complete' }), 'completed');
      }
      return done('complete');
    }

    // --- run the tools ---------------------------------------------------
    //
    // A long run of independent reads looks busy, but it also turns the
    // developer's terminal into a wall of simultaneous rows. Work one bounded
    // batch per model turn; private deferrals keep the tool-call protocol
    // complete without adding visible failures to the timeline.
    const [batch = [], ...laterBatches] = scheduleBatches(requested, registry);
    const deferred = laterBatches.flat();
    {
      if (options.signal?.aborted) return done('cancelled');

      const prepared = batch
        .map((call) => prepare(call, recentCalls, registry))
        .map((item) => {
          if (!cycleEnabled || item.parseError !== null || item.refusal !== null) return item;
          const mutates = isFileMutationTool(item.call.name) || isShellMutation(item.call.name, item.parsed);
          const gate = mutates ? mutationGate(cycle) : null;
          if (gate === null) return item;
          const signature = callSignature(item.call);
          const recorded = recentCalls.lastIndexOf(signature);
          if (recorded >= 0) recentCalls.splice(recorded, 1);
          return { ...item, refusal: gate };
        });
      toolCalls += prepared.length;

      for (const item of prepared) {
        options.bus.emit('agent.tool', {
          turnId,
          id: item.call.id,
          name: item.call.name,
          input: item.parseError ? item.call.arguments : item.parsed,
          phase: 'start',
        });
      }

      const settled = await Promise.all(
        prepared.map(async (item) => {
          options.bus.emit('conversation.event', {
            ...eventBase('tool.started', turnId),
            call: {
              ...item.call,
              arguments: safeToolCallArguments(item.call.arguments),
            },
          });
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
          turnId,
          id: item.call.id,
          name: item.call.name,
          input: item.parsed,
          phase: 'end',
          ok: item.ok,
          durationMs: item.durationMs,
          output: terminalToolOutput(item.call.name, item),
          ...(item.diff ? { diff: item.diff } : {}),
        });
        options.bus.emit('conversation.event', {
          ...eventBase('tool.completed', turnId),
          callId: item.call.id,
          output: item.output,
          ok: item.ok,
          durationMs: item.durationMs,
          ...(item.diff ? { diff: item.diff } : {}),
        });

        let modelToolOutput = item.output;
        if (tokenSplitConfig && options.tokenSplit?.workspace && options.tokenSplit.sessionId && techniqueIsOn(tokenSplitConfig, 'spill')) {
          const spillConfig = tokenSplitConfig.techniques.spill?.config ?? {};
          const spilled = await spillToolOutput(
            options.tokenSplit.workspace,
            options.tokenSplit.sessionId,
            item.call.id,
            item.output,
            {
              maxInlineChars: typeof spillConfig['maxInlineChars'] === 'number' ? Math.max(1, Math.floor(spillConfig['maxInlineChars'])) : 50_000,
              headChars: typeof spillConfig['headChars'] === 'number' ? Math.max(100, Math.floor(spillConfig['headChars'])) : 1_500,
              tailChars: typeof spillConfig['tailChars'] === 'number' ? Math.max(40, Math.floor(spillConfig['tailChars'])) : 300,
              dir: typeof spillConfig['dir'] === 'string' ? spillConfig['dir'] : '.plif/tmp/spill',
            },
          ).catch(() => null);
          if (spilled) {
            modelToolOutput = spilled.content;
            tokenSplitTransformations.push({
              technique: 'spill',
              action: `externalized large tool output to ${spilled.path} (${spilled.bytes} bytes; sha256:${spilled.hash})`,
              tokensAffected: Math.max(0, estimateTokens([{ role: 'tool', content: item.output }]) - estimateTokens([{ role: 'tool', content: spilled.content }])),
              reversible: true,
              marker: spilled.content.match(/…[^\n]+…/)?.[0],
            });
          }
        }
        // The event above is the durable, complete transcript record. The
        // in-memory message is the model-facing context and may contain only
        // the auditable spill pointer; this keeps large output off the wire.
        messages.push({ role: 'tool', content: modelToolOutput, toolCallId: item.call.id });
        if (cycleEnabled && item.ok) {
          if (item.call.name === 'update_plan') {
            setCycle(observeHarnessCycle(cycle, { type: 'plan_ready' }), 'plan_ready');
          }

          const reviewMutationPaths = mutationPaths(item.call.name, item.parsed);
          const actualMutation = isShellMutation(item.call.name, item.parsed) || (
            isFileMutationTool(item.call.name) &&
            (item.call.name === 'resolve_edit_conflict' || item.diff !== undefined) &&
            reviewMutationPaths.length > 0
          );
          if (actualMutation) {
            setCycle(
              observeHarnessCycle(cycle, {
                type: 'mutation',
                paths: reviewMutationPaths,
              }),
              'change_applied',
            );
            reviewReminders = 0;
          } else {
            const inspected = inspectionPaths(item.call.name, item.parsed);
            if (inspected.length > 0) {
              cycle = observeHarnessCycle(cycle, { type: 'inspection', paths: inspected });
            }
            if (isValidationObservation(item.call.name, item.parsed)) {
              cycle = observeHarnessCycle(cycle, { type: 'validation' });
            }
          }
        }
      }

      for (const call of deferred) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content:
            'Deferred by Plif: keep tool batches small and inspect the results before ' +
            'requesting more. Large bursts pollute the developer\'s terminal interface.',
        });
      }

      // The human said something while this was running. It goes in after the
      // tool results and before the model's next turn, so the very next thing
      // it reads is the correction rather than finding out at the end.
      const queued = (await options.drainQueue?.()) ?? [];
      for (const item of queued) {
        const queuedMessage = typeof item === 'string' ? { role: 'user' as const, content: item } : item;
        messages.push({
          ...queuedMessage,
          content:
            `[sent while you were working, read this before continuing]\n${queuedMessage.content}`,
        });
      }
      if (queued.length > 0) {
        options.bus.emit('agent.dequeued', { count: queued.length });
      }

      await persistTokenSplitNotes();

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

      // The next model pass is a distinct visual cycle. Emit this only after
      // tool results are recorded, so the CLI can place a separator exactly in
      // the gap between execution and the next reasoning block.
      //
      // Not every pass earns one. A rule across the terminal is punctuation,
      // and punctuation after every sentence fragment is noise — a discovery
      // burst is six passes in four seconds, and six rules through it say
      // nothing except that the loop iterated. What a separator is actually
      // for is marking a wait the developer sat through, so it is emitted for
      // a cycle that cost real time and skipped for one that did not.
      const cycleMs = Date.now() - turnStartedAt;
      if (cycleMs >= CYCLE_SEPARATOR_MIN_MS) {
        options.bus.emit('agent.cycle', {
          iteration: iterations,
          durationMs: cycleMs,
          toolCalls: settled.length,
        });
      }
    }
  }

  return done('max_iterations');

  function done(stop: LoopStop, error?: PlifError): LoopResult {
    if (stop === 'complete') {
      options.bus.emit('conversation.event', {
        ...eventBase('turn.completed', turnId),
        durationMs: Date.now() - loopStartedAt,
      });
    } else if (stop === 'cancelled') {
      options.bus.emit('conversation.event', {
        ...eventBase('turn.interrupted', turnId),
        reason: 'cancelled',
      });
    } else {
      options.bus.emit('conversation.event', {
        ...eventBase('turn.failed', turnId),
        reason: error?.message ?? stop.replaceAll('_', ' '),
      });
    }
    return {
      stop,
      text,
      messages: answerDanglingToolCalls(messages, stop),
      iterations,
      toolCalls,
      promptTokens,
      completionTokens,
      retries,
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(error ? { error } : {}),
    };
  }

  function emitContextBudget(budget: ContextBudget): void {
    options.bus.emit('agent.context', {
      turnId,
      effectiveInputTokens: budget.effectiveInputTokens,
      availableInputBudget: budget.availableInputBudget,
      reservedOutputTokens: budget.reservedOutputTokens,
      safetyMarginTokens: budget.safetyMarginTokens,
      pressure: budget.pressure,
      breakdown: budget.breakdown,
    });
  }
}

export function answerDanglingToolCalls(
  messages: readonly Message[],
  stop: LoopStop,
): Message[] {
  const answered = new Set(
    messages.flatMap((message) =>
      message.role === 'tool' && message.toolCallId ? [message.toolCallId] : [],
    ),
  );
  const reason = stop === 'cancelled'
    ? 'Cancelled by the developer before this ran.'
    : 'The turn ended before this ran.';

  const reconciled: Message[] = [];
  for (const message of messages) {
    reconciled.push(message);
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
    for (const call of message.toolCalls) {
      if (answered.has(call.id)) continue;
      answered.add(call.id);
      reconciled.push({ role: 'tool', content: reason, toolCallId: call.id });
    }
  }
  return reconciled;
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
export const MAX_PARALLEL_SAFE_CALLS = 3;

export function scheduleBatches(
  calls: readonly ToolCall[],
  registry: Map<string, Tool>,
): ToolCall[][] {
  const batches: ToolCall[][] = [];
  for (const call of calls) {
    const safe = registry.get(call.name)?.parallelSafe === true;
    const open = batches[batches.length - 1];
    if (
      safe &&
      open &&
      open.length < MAX_PARALLEL_SAFE_CALLS &&
      registry.get(open[0]!.name)?.parallelSafe === true
    ) {
      open.push(call);
    }
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
 * Only command execution attached to a debugging signal is recorded. A plain
 * "run the tests" is a basic task, not a learned bug-solving pattern. The
 * reason supplied by the agent becomes a low-cardinality issue context, so the
 * same approach must succeed on four distinct debugging situations before it
 * becomes established guidance.
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
  if (
    !options.memory ||
    !options.workspace ||
    (call.name !== 'run_command' && call.name !== 'shell_command')
  ) return;

  const argv = Array.isArray(parsed['argv']) ? (parsed['argv'] as string[]) : [];
  const script = typeof parsed['script'] === 'string' ? parsed['script'] : '';
  const goal = call.name === 'run_command'
    ? argv[0]
    : options.shellDialect?.executable ?? options.shellDialect?.id ?? 'shell';
  const approach = call.name === 'run_command' ? argv.join(' ') : script;
  if (!goal || !approach) return;
  const reason = typeof parsed['reason'] === 'string' ? parsed['reason'].trim() : '';
  if (!isDebuggingSignal(reason)) return;

  await options.memory
    .recordOutcome({
      workspace: options.workspace,
      goal,
      approach,
      ok,
      context: {
        os: process.platform,
        command: goal,
        container: options.container.name,
        issue: learningContext(reason),
      },
      sessionId: options.sessionId ?? 'unknown',
      durationMs,
    })
    .catch(() => undefined);
}

const DEBUGGING_SIGNAL = /\b(?:bug|debug|error|failure|fail(?:ed|ing)?|broken|fix|repair|regression|crash|exception)\b/i;

function isDebuggingSignal(reason: string): boolean {
  return DEBUGGING_SIGNAL.test(reason);
}

function learningContext(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(?:[a-z]:)?[\\/][^ ]+/g, '<path>')
    .slice(0, 96);
}

async function executeCall(input: {
  call: ToolCall;
  parsed: Record<string, unknown>;
  parseError: string | null;
  registry: Map<string, Tool>;
  options: LoopOptions;
}): Promise<{ output: string; ok: boolean; diff?: string; display?: string }> {
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
      ...(options.shellDialect ? { shellDialect: options.shellDialect } : {}),
      ...(options.activateProfile ? { activateProfile: options.activateProfile } : {}),
      ...(options.setGoal ? { setGoal: options.setGoal } : {}),
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
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
