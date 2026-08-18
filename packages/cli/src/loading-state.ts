import { useSyncExternalStore } from 'react';

export type LoadingPhase =
  | 'idle'
  | 'starting'
  | 'waiting'
  | 'reasoning'
  | 'streaming'
  | 'tool'
  | 'cancelling'
  | 'done'
  | 'error';

export type LoadingTokenSource = 'pending' | 'estimated' | 'reported';

/**
 * The normalized activity phase consumed by presentation.
 *
 * The core still emits factual events (`agent.reasoning`, `agent.tool`,
 * `agent.text`, ...). The CLI owns this small model so the loading surface
 * does not have to infer state from several unrelated React values.
 */
export type ActivityPhase = LoadingPhase;

export interface ActivityTool {
  readonly id: string;
  readonly name: string;
  readonly startedAt: number;
}

export interface LoadingSnapshot {
  readonly operationId: number;
  readonly turnId: string | null;
  readonly phase: LoadingPhase;
  /** Monotonic milliseconds, never wall-clock time. */
  readonly startedAt: number | null;
  readonly reasoningStartedAt: number | null;
  readonly reasoningMs: number;
  readonly tokens: number;
  readonly estimatedTokens: boolean;
  /** Whether the count is unavailable, estimated from deltas, or provider-reported. */
  readonly tokenSource: LoadingTokenSource;
  /** The one tool currently owning the activity line, if any. */
  readonly activeTool: ActivityTool | null;
  /** All active tools, retained for parallel calls and aggregation. */
  readonly activeTools: readonly ActivityTool[];
  /** Number of tool calls completed during this operation. */
  readonly completedTools: number;
  /** A redacted failure label, never a provider payload or credential. */
  readonly error: string | null;
}

const IDLE_SNAPSHOT: LoadingSnapshot = Object.freeze({
  operationId: 0,
  turnId: null,
  phase: 'idle',
  startedAt: null,
  reasoningStartedAt: null,
  reasoningMs: 0,
  tokens: 0,
  estimatedTokens: false,
  tokenSource: 'pending',
  activeTool: null,
  activeTools: [],
  completedTools: 0,
  error: null,
});

export function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function elapsedSince(startedAt: number | null, now = monotonicNow()): number {
  return startedAt === null ? 0 : Math.max(0, Math.floor(now - startedAt));
}

/**
 * The live operational state is deliberately outside App's reducer. Stream
 * deltas can arrive much faster than the rest of the terminal needs to paint;
 * this store lets only the loading surface observe the low-rate metric changes.
 */
export class LoadingTelemetryStore {
  #snapshot: LoadingSnapshot = IDLE_SNAPSHOT;
  #listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): LoadingSnapshot => this.#snapshot;

  start(operationId: number, turnId: string | null, at = monotonicNow()): void {
    this.#set({
      operationId,
      turnId,
      phase: 'starting',
      startedAt: at,
      reasoningStartedAt: null,
      reasoningMs: 0,
      tokens: 0,
      estimatedTokens: true,
      tokenSource: 'pending',
      activeTool: null,
      activeTools: [],
      completedTools: 0,
      error: null,
    });
  }

  phase(operationId: number, phase: Exclude<LoadingPhase, 'idle' | 'done' | 'error'>): void {
    if (!this.#current(operationId)) return;
    this.#set({ ...this.#snapshot, phase });
  }

  reasoningStart(operationId: number, at = monotonicNow()): void {
    if (!this.#current(operationId)) return;
    this.#set({
      ...this.#snapshot,
      phase: 'reasoning',
      reasoningStartedAt: this.#snapshot.reasoningStartedAt ?? at,
    });
  }

  reasoningEnd(operationId: number, durationMs?: number, at = monotonicNow()): void {
    if (!this.#current(operationId)) return;
    const active = this.#snapshot.reasoningStartedAt;
    const measured = durationMs !== undefined
      ? Math.max(0, Math.floor(durationMs))
      : active === null
        ? 0
        : elapsedSince(active, at);
    this.#set({
      ...this.#snapshot,
      phase: this.#snapshot.phase === 'reasoning' ? 'waiting' : this.#snapshot.phase,
      reasoningStartedAt: null,
      reasoningMs: this.#snapshot.reasoningMs + measured,
    });
  }

  /** Normalize a factual tool-start event into the current operation. */
  toolStart(operationId: number, id: string, name: string, at = monotonicNow()): void {
    if (!this.#current(operationId)) return;
    if (this.#snapshot.activeTools.some((tool) => tool.id === id)) return;
    const activeTool = { id, name, startedAt: at };
    this.#set({
      ...this.#snapshot,
      phase: 'tool',
      activeTool,
      activeTools: [...this.#snapshot.activeTools, activeTool],
    });
  }

  /** Resolve only the matching tool; late completions cannot change newer work. */
  toolEnd(operationId: number, id: string, ok = true): void {
    if (!this.#current(operationId)) return;
    const activeTools = this.#snapshot.activeTools.filter((tool) => tool.id !== id);
    if (activeTools.length === this.#snapshot.activeTools.length) return;
    const activeTool = activeTools.at(-1) ?? null;
    this.#set({
      ...this.#snapshot,
      phase: activeTools.length > 0 ? 'tool' : this.#snapshot.phase === 'tool' ? 'waiting' : this.#snapshot.phase,
      activeTool,
      activeTools,
      completedTools: this.#snapshot.completedTools + 1,
      ...(ok ? {} : { error: 'tool failed' }),
    });
  }

  /** Record a redacted operation failure without storing provider payloads. */
  fail(operationId: number, message = 'request failed'): void {
    if (!this.#current(operationId)) return;
    this.#set({ ...this.#snapshot, phase: 'error', activeTool: null, activeTools: [], error: message });
  }

  tokens(operationId: number, tokens: number, estimated: boolean): void {
    if (!this.#current(operationId)) return;
    const next = Math.max(0, Math.floor(tokens));
    const tokenSource: LoadingTokenSource = next > 0
      ? estimated ? 'estimated' : 'reported'
      : this.#snapshot.tokenSource;
    if (
      next === this.#snapshot.tokens &&
      estimated === this.#snapshot.estimatedTokens &&
      tokenSource === this.#snapshot.tokenSource
    ) return;
    this.#set({ ...this.#snapshot, tokens: next, estimatedTokens: estimated, tokenSource });
  }

  finish(operationId: number, result: 'done' | 'error' | 'cancelled'): void {
    if (!this.#current(operationId)) return;
    this.#set({
      ...this.#snapshot,
      phase: result === 'cancelled' ? 'cancelling' : result,
      reasoningStartedAt: null,
      activeTool: null,
      activeTools: [],
    });
  }

  reset(): void {
    this.#set(IDLE_SNAPSHOT);
  }

  #current(operationId: number): boolean {
    return this.#snapshot.operationId === operationId && this.#snapshot.phase !== 'idle';
  }

  #set(next: LoadingSnapshot): void {
    if (sameSnapshot(this.#snapshot, next)) return;
    this.#snapshot = next;
    for (const listener of [...this.#listeners]) listener();
  }
}

/** The single activity source used by loading and operational presentation. */
export const activityModel = new LoadingTelemetryStore();
/** Compatibility name retained for existing call sites and external tests. */
export const loadingTelemetry = activityModel;

function sameSnapshot(left: LoadingSnapshot, right: LoadingSnapshot): boolean {
  return left.operationId === right.operationId &&
    left.turnId === right.turnId &&
    left.phase === right.phase &&
    left.startedAt === right.startedAt &&
    left.reasoningStartedAt === right.reasoningStartedAt &&
    left.reasoningMs === right.reasoningMs &&
    left.tokens === right.tokens &&
    left.estimatedTokens === right.estimatedTokens &&
    left.tokenSource === right.tokenSource &&
    left.activeTool?.id === right.activeTool?.id &&
    left.activeTool?.name === right.activeTool?.name &&
    left.activeTool?.startedAt === right.activeTool?.startedAt &&
    left.activeTools.length === right.activeTools.length &&
    left.activeTools.every((tool, index) => {
      const other = right.activeTools[index];
      return other?.id === tool.id && other.name === tool.name && other.startedAt === tool.startedAt;
    }) &&
    left.completedTools === right.completedTools &&
    left.error === right.error;
}

export function useLoadingSnapshot(active = true): LoadingSnapshot {
  return useSyncExternalStore(
    active ? activityModel.subscribe : (() => () => undefined),
    active ? activityModel.getSnapshot : () => IDLE_SNAPSHOT,
    active ? activityModel.getSnapshot : () => IDLE_SNAPSHOT,
  );
}

const SPINNER_VERBS = [
  'Brewing',
  'Marinating',
  'Whisking',
  'Infusing',
  'Cerebrating',
  'Cogitating',
  'Deciphering',
  'Deliberating',
  'Musing',
  'Pondering',
  'Reflecting',
  'Ruminating',
  'Synthesizing',
  'Untangling',
  'Architecting',
  'Assembling',
  'Composing',
  'Crafting',
  'Deriving',
  'Forging',
  'Generating',
  'Mapping',
  'Orchestrating',
  'Parsing',
  'Refining',
  'Resolving',
  'Structuring',
  'Tracing',
  'Unfurling',
  'Weaving',
] as const;

const VERB_INTERVAL_MS = 2_400;

/** Deterministic shuffle bag: a new operation gets variety without randomness in render. */
function verbOrder(seed: number): readonly number[] {
  const order = SPINNER_VERBS.map((_, index) => index);
  let value = Math.abs(Math.trunc(seed)) + 0x9e3779b9;
  for (let index = order.length - 1; index > 0; index -= 1) {
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    const swap = Math.abs(value) % (index + 1);
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return order;
}

export function loadingVerbAt(elapsedMs: number, seed: number): string {
  const order = verbOrder(seed);
  const index = Math.floor(Math.max(0, elapsedMs) / VERB_INTERVAL_MS) % order.length;
  return SPINNER_VERBS[order[index]!] as string;
}

export function loadingVerbPool(): readonly string[] {
  return SPINNER_VERBS;
}

export function formatLoadingDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  if (minutes > 0) return `${minutes}m${seconds > 0 ? ` ${seconds}s` : ''}`;
  return `${seconds}s`;
}

export function formatLoadingTokens(tokens: number): string {
  const value = Math.max(0, Math.floor(tokens));
  if (value < 1_000) return `${value}`;
  const compact = (value / 1_000).toFixed(1).replace(/\.0$/, '');
  return `${compact}k`;
}

export function loadingVerbIntervalMs(): number {
  return VERB_INTERVAL_MS;
}
