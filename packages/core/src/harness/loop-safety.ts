import { createHash } from 'node:crypto';

/** Runtime states used to make a stalled run observable and finite. */
export type StagnationState =
  | 'normal'
  | 'suspected_stagnation'
  | 'recovery_required'
  | 'hard_stop';

/**
 * Safety policy for one autonomous run.
 *
 * Stagnation limits and the total economic limit are deliberately separate:
 * productive long tasks may spend a lot overall, while an unproductive task
 * must stop much earlier.
 */
export interface AgentExecutionPolicy {
  readonly softTokensWithoutProgress: number;
  readonly hardTokensWithoutProgress: number;
  readonly maxIterationsWithoutProgress: number;
  readonly maxRecoveryAttempts: number;
  readonly maxRepeatedActions: number;
  readonly repeatedSequenceWindow: number;
  readonly maxRunTokens: number;
  readonly maxRetries: number;
}

export const DEFAULT_AGENT_EXECUTION_POLICY: AgentExecutionPolicy = Object.freeze({
  softTokensWithoutProgress: 24_000,
  hardTokensWithoutProgress: 60_000,
  maxIterationsWithoutProgress: 4,
  maxRecoveryAttempts: 1,
  maxRepeatedActions: 2,
  repeatedSequenceWindow: 6,
  // The iteration, repeated-action and no-progress watchdogs stop loops. This
  // ceiling is only the last-resort guard for an otherwise productive long run.
  maxRunTokens: 10_000_000,
  maxRetries: 3,
});

export interface ProgressSnapshot {
  readonly progressEpoch: number;
  readonly iterationCount: number;
  readonly iterationsSinceProgress: number;
  readonly totalRunTokens: number;
  readonly tokensSinceProgress: number;
  readonly lastProgressAt: number | null;
  readonly recoveryAttempts: number;
  readonly stagnationState: StagnationState;
}

export type WatchdogDecision =
  | { readonly kind: 'allow'; readonly snapshot: ProgressSnapshot }
  | { readonly kind: 'recover'; readonly snapshot: ProgressSnapshot }
  | { readonly kind: 'stop'; readonly reason: 'stagnation' | 'run_budget'; readonly snapshot: ProgressSnapshot };

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.floor(value)
    : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value >= 0
    ? Math.floor(value)
    : fallback;
}

export function resolveAgentExecutionPolicy(
  overrides: Partial<AgentExecutionPolicy> | undefined,
): AgentExecutionPolicy {
  const soft = positive(overrides?.softTokensWithoutProgress, DEFAULT_AGENT_EXECUTION_POLICY.softTokensWithoutProgress);
  const hard = Math.max(soft, positive(overrides?.hardTokensWithoutProgress, DEFAULT_AGENT_EXECUTION_POLICY.hardTokensWithoutProgress));
  return Object.freeze({
    softTokensWithoutProgress: soft,
    hardTokensWithoutProgress: hard,
    maxIterationsWithoutProgress: positive(overrides?.maxIterationsWithoutProgress, DEFAULT_AGENT_EXECUTION_POLICY.maxIterationsWithoutProgress),
    maxRecoveryAttempts: nonNegative(overrides?.maxRecoveryAttempts, DEFAULT_AGENT_EXECUTION_POLICY.maxRecoveryAttempts),
    maxRepeatedActions: positive(overrides?.maxRepeatedActions, DEFAULT_AGENT_EXECUTION_POLICY.maxRepeatedActions),
    repeatedSequenceWindow: Math.max(2, Math.min(12, positive(overrides?.repeatedSequenceWindow, DEFAULT_AGENT_EXECUTION_POLICY.repeatedSequenceWindow))),
    maxRunTokens: positive(overrides?.maxRunTokens, DEFAULT_AGENT_EXECUTION_POLICY.maxRunTokens),
    maxRetries: nonNegative(overrides?.maxRetries, DEFAULT_AGENT_EXECUTION_POLICY.maxRetries),
  });
}

/**
 * Small deterministic watchdog. It knows nothing about React, prompts or
 * chain-of-thought; callers explicitly mark observable execution progress.
 */
export class ProgressWatchdog {
  readonly policy: AgentExecutionPolicy;
  #progressEpoch = 0;
  #iterationCount = 0;
  #iterationsSinceProgress = 0;
  #totalRunTokens = 0;
  #tokensSinceProgress = 0;
  #lastProgressAt: number | null = null;
  #recoveryAttempts = 0;
  #stagnationState: StagnationState = 'normal';

  constructor(policy: Partial<AgentExecutionPolicy> | undefined = undefined) {
    this.policy = resolveAgentExecutionPolicy(policy);
  }

  beginIteration(): void {
    this.#iterationCount += 1;
    this.#iterationsSinceProgress += 1;
  }

  recordTokens(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    const amount = Math.floor(tokens);
    this.#totalRunTokens += amount;
    this.#tokensSinceProgress += amount;
  }

  /** Mark externally observable work, not model output or status rendering. */
  markProgress(): void {
    this.#progressEpoch += 1;
    this.#iterationsSinceProgress = 0;
    this.#tokensSinceProgress = 0;
    this.#lastProgressAt = Date.now();
    this.#recoveryAttempts = 0;
    this.#stagnationState = 'normal';
  }

  markRecoveryAttempt(): void {
    this.#recoveryAttempts += 1;
    this.#stagnationState = 'recovery_required';
  }

  snapshot(): ProgressSnapshot {
    return {
      progressEpoch: this.#progressEpoch,
      iterationCount: this.#iterationCount,
      iterationsSinceProgress: this.#iterationsSinceProgress,
      totalRunTokens: this.#totalRunTokens,
      tokensSinceProgress: this.#tokensSinceProgress,
      lastProgressAt: this.#lastProgressAt,
      recoveryAttempts: this.#recoveryAttempts,
      stagnationState: this.#stagnationState,
    };
  }

  evaluate(): WatchdogDecision {
    const snapshot = this.snapshot();
    if (snapshot.totalRunTokens >= this.policy.maxRunTokens) {
      this.#stagnationState = 'hard_stop';
      return { kind: 'stop', reason: 'run_budget', snapshot: this.snapshot() };
    }

    const suspicious =
      snapshot.tokensSinceProgress >= this.policy.softTokensWithoutProgress ||
      snapshot.iterationsSinceProgress >= this.policy.maxIterationsWithoutProgress;
    if (!suspicious) {
      this.#stagnationState = 'normal';
      return { kind: 'allow', snapshot: this.snapshot() };
    }

    const hard = snapshot.tokensSinceProgress >= this.policy.hardTokensWithoutProgress;
    if (hard || snapshot.recoveryAttempts >= this.policy.maxRecoveryAttempts) {
      this.#stagnationState = 'hard_stop';
      return { kind: 'stop', reason: 'stagnation', snapshot: this.snapshot() };
    }

    this.#stagnationState = 'suspected_stagnation';
    return { kind: 'recover', snapshot: this.snapshot() };
  }
}

export interface ActionObservation {
  readonly repeated: boolean;
  readonly sequence: boolean;
  readonly count: number;
}

/** Bounded deterministic detector for A→A and short A→B→A→B cycles. */
export class ActionLoopDetector {
  readonly maxRepeatedActions: number;
  readonly sequenceWindow: number;
  #recent: string[] = [];
  #counts = new Map<string, number>();

  constructor(policy: Pick<AgentExecutionPolicy, 'maxRepeatedActions' | 'repeatedSequenceWindow'>) {
    this.maxRepeatedActions = policy.maxRepeatedActions;
    this.sequenceWindow = policy.repeatedSequenceWindow;
  }

  observe(fingerprint: string): ActionObservation {
    const count = (this.#counts.get(fingerprint) ?? 0) + 1;
    this.#counts.set(fingerprint, count);
    this.#recent.push(fingerprint);
    if (this.#recent.length > this.sequenceWindow) this.#recent.shift();
    return {
      repeated: count > this.maxRepeatedActions,
      sequence: this.#hasRepeatedSequence(),
      count,
    };
  }

  reset(): void {
    this.#recent.length = 0;
    this.#counts.clear();
  }

  #hasRepeatedSequence(): boolean {
    const length = this.#recent.length;
    for (let size = 2; size <= Math.floor(length / 2); size += 1) {
      const start = length - size * 2;
      const first = this.#recent.slice(start, start + size);
      const second = this.#recent.slice(start + size);
      if (first.length === size && first.every((value, index) => value === second[index])) return true;
    }
    return false;
  }
}

/** Stable, secret-safe executable-action fingerprint. */
export function actionFingerprint(
  actionType: string,
  normalizedArguments: string,
  stateVersion: number,
): string {
  return createHash('sha256')
    .update(actionType)
    .update('\0')
    .update(normalizedArguments)
    .update('\0')
    .update(String(stateVersion))
    .digest('hex');
}

/** Canonical JSON preserves array order but sorts object keys recursively. */
export function normalizeActionArguments(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(normalizeActionArguments).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${normalizeActionArguments(record[key])}`).join(',')}}`;
}

export interface SingleFlightToken {
  readonly id: number;
}

/** One owner for a logical asynchronous transition. */
export class SingleFlight {
  #nextId = 0;
  #active = false;

  claim(): SingleFlightToken | null {
    if (this.#active) return null;
    this.#active = true;
    this.#nextId += 1;
    return { id: this.#nextId };
  }

  release(token: SingleFlightToken): void {
    if (this.#active && token.id === this.#nextId) this.#active = false;
  }
}
