import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';

export type GoalStatus = 'active' | 'paused' | 'complete' | 'blocked';

export interface GoalState {
  readonly condition: string;
  readonly status: GoalStatus;
  readonly revision: number;
  readonly rounds: number;
  readonly blockedReason: string | null;
  readonly updatedAt: number;
  readonly workspace: string;
  readonly armed: boolean;
  readonly maxRounds: number;
  readonly blockStreak: number;
  readonly evidence?: string;
}

const DEFAULT_MAX_ROUNDS = 16;

function positiveInteger(value: unknown, fallback: number, maximum = 128): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(parsed)));
}

function envMaxRounds(): number {
  return positiveInteger(process.env['PLIF_MAX_GOAL_ROUNDS'], DEFAULT_MAX_ROUNDS);
}

function clone(state: GoalState | null): GoalState | null {
  return state ? { ...state } : null;
}

/** Durable, single-workspace goal state. The file is separate from sessions. */
export class GoalController {
  readonly #file: string;
  readonly #workspace: string;
  #state: GoalState | null = null;
  #maxRounds: number;
  #ready: Promise<void>;

  constructor(root: string, workspace: string, maxRounds?: number) {
    this.#file = path.join(root, 'goal.json');
    this.#workspace = path.resolve(workspace);
    this.#maxRounds = positiveInteger(maxRounds, envMaxRounds());
    this.#ready = this.#load();
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  setMaxRounds(value: number | undefined): void {
    this.#maxRounds = positiveInteger(value, this.#maxRounds);
    if (this.#state && this.#state.maxRounds !== this.#maxRounds) {
      this.#state = { ...this.#state, maxRounds: this.#maxRounds, updatedAt: Date.now() };
      void this.#persist(this.#state);
    }
  }

  get(): GoalState | null {
    return clone(this.#state);
  }

  async setUserGoal(condition: string): Promise<GoalState> {
    await this.ready();
    return await this.#replace({
      condition: this.#condition(condition),
      status: 'active',
      armed: true,
      rounds: 0,
      blockedReason: null,
      blockStreak: 0,
      evidence: undefined,
    });
  }

  /** Model-provided context is intentionally never armed. */
  async setModelGoal(condition: string): Promise<GoalState> {
    await this.ready();
    return await this.#replace({
      condition: this.#condition(condition),
      status: 'active',
      armed: false,
      rounds: 0,
      blockedReason: null,
      blockStreak: 0,
      evidence: undefined,
    });
  }

  async clear(): Promise<GoalState | null> {
    await this.ready();
    if (!this.#state) return null;
    return await this.#replace({ status: 'paused', armed: false, blockedReason: null, blockStreak: 0 });
  }

  async pause(reason?: string): Promise<GoalState | null> {
    await this.ready();
    if (!this.#state) return null;
    return await this.#replace({
      status: 'paused',
      armed: false,
      ...(reason?.trim() ? { blockedReason: reason.trim().slice(0, 1000) } : {}),
    });
  }

  /** Arm the next autonomous round and advance the CAS revision. */
  async startRound(): Promise<GoalState | null> {
    await this.ready();
    const current = this.#state;
    if (!current || current.status !== 'active' || !current.armed || current.rounds >= current.maxRounds) {
      return null;
    }
    // Keep a blocker across autonomous rounds. `block_goal` uses the same
    // reason and streak to prove that the obstacle persisted; resetting it
    // here would make the required three-round CAS impossible to satisfy.
    return await this.#replace({ rounds: current.rounds + 1 });
  }

  async complete(revision: number, evidence: string): Promise<GoalState> {
    await this.ready();
    const current = this.#assertRevision(revision);
    if (current.status !== 'active') {
      throw new PlifError('INVALID_ARGUMENT', `goal is ${current.status}, not active`);
    }
    const trimmed = evidence.trim();
    if (!trimmed) throw new PlifError('INVALID_ARGUMENT', 'complete_goal requires evidence');
    return await this.#replace({ status: 'complete', armed: false, evidence: trimmed.slice(0, 4000) });
  }

  async block(revision: number, reason: string): Promise<GoalState> {
    await this.ready();
    const current = this.#assertRevision(revision);
    if (current.status !== 'active') {
      throw new PlifError('INVALID_ARGUMENT', `goal is ${current.status}, not active`);
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new PlifError('INVALID_ARGUMENT', 'block_goal requires a reason');
    const sameReason = current.blockedReason === trimmed;
    const streak = sameReason ? current.blockStreak + 1 : 1;
    if (current.rounds < 3 || streak < 3) {
      this.#state = {
        ...current,
        revision: current.revision + 1,
        blockedReason: trimmed.slice(0, 2000),
        blockStreak: streak,
        updatedAt: Date.now(),
      };
      await this.#persist(this.#state);
      throw new PlifError(
        'INVALID_ARGUMENT',
        `block_goal requires the same blocker for 3 rounds (${streak}/3 recorded)`,
      );
    }
    return await this.#replace({
      status: 'blocked',
      armed: false,
      blockedReason: trimmed.slice(0, 2000),
      blockStreak: streak,
    });
  }

  #condition(value: string): string {
    const condition = value.trim();
    if (!condition) throw new PlifError('INVALID_ARGUMENT', 'goal condition must be non-empty');
    if (condition.length > 2000) throw new PlifError('INVALID_ARGUMENT', 'goal condition must be 2000 characters or fewer');
    return condition;
  }

  #assertRevision(revision: number): GoalState {
    const current = this.#state;
    if (!current) throw new PlifError('INVALID_ARGUMENT', 'no goal is configured');
    if (!Number.isInteger(revision) || revision !== current.revision) {
      throw new PlifError('INVALID_ARGUMENT', `goal revision conflict: expected ${current.revision}, received ${String(revision)}`);
    }
    return current;
  }

  async #replace(changes: Partial<GoalState>): Promise<GoalState> {
    const current = this.#state;
    const hasEvidence = Object.prototype.hasOwnProperty.call(changes, 'evidence');
    const next: GoalState = {
      condition: changes.condition ?? current?.condition ?? '',
      status: changes.status ?? current?.status ?? 'active',
      revision: (current?.revision ?? 0) + 1,
      rounds: changes.rounds ?? current?.rounds ?? 0,
      blockedReason: changes.blockedReason === undefined ? (current?.blockedReason ?? null) : changes.blockedReason,
      updatedAt: Date.now(),
      workspace: this.#workspace,
      armed: changes.armed ?? current?.armed ?? false,
      maxRounds: changes.maxRounds ?? current?.maxRounds ?? this.#maxRounds,
      blockStreak: changes.blockStreak ?? current?.blockStreak ?? 0,
      ...(hasEvidence
        ? (changes.evidence !== undefined ? { evidence: changes.evidence } : {})
        : current?.evidence
          ? { evidence: current.evidence }
          : {}),
    };
    this.#state = next;
    await this.#persist(next);
    return clone(next) as GoalState;
  }

  async #load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.#file, 'utf8')) as Partial<GoalState>;
      if (raw.workspace !== this.#workspace || typeof raw.condition !== 'string') return;
      const status = raw.status;
      if (status !== 'active' && status !== 'paused' && status !== 'complete' && status !== 'blocked') return;
      this.#state = {
        condition: raw.condition.slice(0, 2000),
        status,
        revision: Number.isInteger(raw.revision) ? raw.revision as number : 0,
        rounds: Number.isInteger(raw.rounds) ? Math.max(0, raw.rounds as number) : 0,
        blockedReason: typeof raw.blockedReason === 'string' ? raw.blockedReason : null,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
        workspace: this.#workspace,
        armed: raw.armed === true,
        maxRounds: positiveInteger(raw.maxRounds, this.#maxRounds),
        blockStreak: Number.isInteger(raw.blockStreak) ? Math.max(0, raw.blockStreak as number) : 0,
        ...(typeof raw.evidence === 'string' ? { evidence: raw.evidence.slice(0, 4000) } : {}),
      };
    } catch {
      // A missing or partial goal file must never prevent the CLI from booting.
      this.#state = null;
    }
  }

  async #persist(state: GoalState): Promise<void> {
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    try {
      await fs.rename(temp, this.#file);
    } catch (error) {
      // Windows does not replace an existing file with rename. Removing only
      // the exact goal target keeps the write recoverable and scoped.
      await fs.rm(this.#file, { force: true });
      await fs.rename(temp, this.#file).catch(() => { throw error; });
    }
  }
}
