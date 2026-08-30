import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import { workspaceKey } from '../session/store.js';
import type { StorePaths } from '../store/paths.js';
import { assess, guide } from './learning.js';
import type { Context, Guidance, Outcome, Strategy } from './learning.js';
import { MemoryRepository } from './memory-repository.js';

export type FactKind = 'fact' | 'failure';
export type MemoryScope = 'global' | 'workspace';

export interface Fact {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly kind: FactKind;
  readonly text: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confirmations: number;
  readonly contradictions: number;
  readonly tags: readonly string[];
}

export interface MemorySnapshot {
  readonly strategies: readonly Strategy[];
  readonly facts: readonly Fact[];
  readonly failures: readonly Fact[];
  readonly notes: string;
  readonly guidance: Guidance;
}

const FACT_STALE_AFTER_CONTRADICTIONS = 2;
const CREDENTIAL_LIKE_TEXT = /(?:^|[^A-Za-z0-9_])sk_[A-Za-z0-9_-]{16,}/;

function rejectCredentialLikeText(text: string): void {
  if (CREDENTIAL_LIKE_TEXT.test(text)) {
    throw new PlifError('INVALID_ARGUMENT', 'credentials cannot be stored in memory; use /env instead');
  }
}

export class MemoryStore {
  #paths: StorePaths;
  #repository: Promise<MemoryRepository>;
  #legacyChecked = new Set<string>();

  constructor(paths: StorePaths) {
    this.#paths = paths;
    this.#repository = MemoryRepository.open(paths.memoryDb);
  }

  #dir(workspace: string): string {
    return path.join(this.#paths.root, 'memory', workspaceKey(workspace));
  }

  #file(workspace: string, name: string): string {
    return path.join(this.#dir(workspace), name);
  }

  async #readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw new PlifError('INTERNAL', `memory file is unreadable: ${path.basename(file)}`, {
        cause: error,
        detail: { file },
        hint: 'Delete it to start this workspace’s memory over.',
      });
    }
  }

  async #writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temp, file);
  }

  async strategies(workspace: string): Promise<Strategy[]> {
    await this.#migrateLegacy(workspace);
    return (await this.#repository).strategies(workspace);
  }

  async recordOutcome(input: {
    workspace: string;
    goal: string;
    approach: string;
    ok: boolean;
    context: Context;
    sessionId: string;
    note?: string;
    durationMs?: number;
  }): Promise<Strategy> {
    await this.#migrateLegacy(input.workspace);
    return (await this.#repository).recordOutcome(input);
  }

  async facts(workspace: string): Promise<Fact[]> {
    await this.#migrateLegacy(workspace);
    return (await this.#repository).facts(workspace, false);
  }

  async remember(input: {
    workspace: string;
    kind: FactKind;
    text: string;
    tags?: readonly string[];
    scope?: MemoryScope;
  }): Promise<Fact> {
    rejectCredentialLikeText(input.text);
    await this.#migrateLegacy(input.workspace);
    return (await this.#repository).remember({
      workspace: input.workspace,
      scope: input.scope ?? 'workspace',
      kind: input.kind,
      text: input.text,
      tags: input.tags ?? [],
    });
  }

  async contradict(workspace: string, id: string): Promise<Fact | null> {
    await this.#migrateLegacy(workspace);
    return (await this.#repository).contradict(workspace, id);
  }

  async notes(workspace: string): Promise<string> {
    await this.#migrateLegacy(workspace);
    return (await this.#repository).notes(workspace);
  }

  async writeNotes(workspace: string, contents: string): Promise<void> {
    await this.#migrateLegacy(workspace);
    await (await this.#repository).writeNotes(workspace, contents);
  }

  async appendNote(workspace: string, line: string): Promise<void> {
    const current = await this.notes(workspace);
    const stamped = `- ${line.trim()}`;
    if (current.includes(stamped)) return;
    await this.writeNotes(workspace, current ? `${current.trimEnd()}\n${stamped}\n` : `${stamped}\n`);
  }

  async snapshot(workspace: string): Promise<MemorySnapshot> {
    const [strategies, facts, notes] = await Promise.all([
      this.#allStrategies(workspace),
      this.#allFacts(workspace),
      this.notes(workspace),
    ]);

    return {
      strategies,
      facts: facts.filter((fact) => fact.kind === 'fact'),
      failures: facts.filter((fact) => fact.kind === 'failure'),
      notes,
      guidance: guide(strategies),
    };
  }

  async forget(workspace: string): Promise<void> {
    await (await this.#repository).forget(workspace);
  }

  async globalFacts(): Promise<Fact[]> {
    return (await this.#repository).facts('', false);
  }

  async rememberGlobal(input: { kind: FactKind; text: string; tags?: readonly string[] }): Promise<Fact> {
    rejectCredentialLikeText(input.text);
    return (await this.#repository).remember({ workspace: '', scope: 'global', kind: input.kind, text: input.text, tags: input.tags ?? [] });
  }

  async readOnlySnapshot(workspace: string): Promise<MemorySnapshot> {
    return this.snapshot(workspace);
  }

  async #allFacts(workspace: string): Promise<Fact[]> {
    await this.#migrateLegacy(workspace);
    return (await this.#repository).facts(workspace, true);
  }

  async #allStrategies(workspace: string): Promise<Strategy[]> {
    await this.#migrateLegacy(workspace);
    return (await this.#repository).strategies(workspace, true);
  }

  async #migrateLegacy(workspace: string): Promise<void> {
    const key = workspaceKey(workspace);
    if (this.#legacyChecked.has(key)) return;
    const facts = await this.#readJson<Fact[]>(this.#file(workspace, 'facts.json'), []);
    const strategies = await this.#readJson<Strategy[]>(this.#file(workspace, 'strategies.json'), []);
    const notes = await this.#readJsonFile(this.#file(workspace, 'notes.md'));
    await (await this.#repository).importLegacy({ workspace: path.resolve(workspace), facts, strategies, notes });
    this.#legacyChecked.add(key);
  }

  async #readJsonFile(file: string): Promise<string> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return '';
    }
  }
}

export function strategyId(goal: string, approach: string): string {
  return createHash('sha256').update(`${goal.trim()}\0${approach.trim()}`).digest('hex').slice(0, 12);
}

/**
 * Which facts are worth the prompt budget.
 *
 * By how often they have held up, not by when they were written. Recency was
 * the wrong axis: a fact confirmed a dozen times across weeks is the closest
 * thing this store has to knowledge, and taking the last eight entries dropped
 * it the moment eight new one-off observations landed. Contradictions count
 * against, so something the workspace has already disagreed with loses its
 * place to something it has not.
 */
export function rankFacts(facts: readonly Fact[], limit: number): readonly Fact[] {
  return [...facts]
    .sort((left, right) => {
      const weight = (fact: Fact): number => fact.confirmations - fact.contradictions * 2;
      const byWeight = weight(right) - weight(left);
      return byWeight !== 0 ? byWeight : Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })
    .slice(0, limit);
}

export function summariseMemory(snapshot: MemorySnapshot, limit = 8): string {
  const sections: string[] = [];

  if (snapshot.facts.length > 0) {
    sections.push(
      'Known about this project:\n' +
        rankFacts(snapshot.facts, limit)
          .map((fact) => `- ${fact.text}${fact.confirmations > 1 ? ` (seen ${fact.confirmations}x)` : ''}`)
          .join('\n'),
    );
  }

  if (snapshot.failures.length > 0) {
    sections.push(
      'Known not to work here:\n' +
        rankFacts(snapshot.failures, limit).map((fact) => `- ${fact.text}`).join('\n'),
    );
  }

  const briefing = snapshot.guidance.briefing.trim();
  if (briefing) sections.push(briefing);

  return sections.join('\n\n');
}

export function strategyStatus(strategy: Strategy): string {
  const assessment = assess(strategy);
  return `${assessment.confidence} (${assessment.independentSuccesses} independent, ${assessment.failures} failed)`;
}
