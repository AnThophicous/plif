import { createHash, randomUUID } from 'node:crypto';

import { SqliteDatabase } from '../persistence/sqlite.js';
import type { SqliteStatement, SqliteValue } from '../persistence/sqlite.js';
import { workspaceKey } from '../session/store.js';
import type { Strategy, Context, Outcome } from './learning.js';
import type { Fact, FactKind, MemoryScope } from './memory.js';
import { MEMORY_MIGRATIONS } from './memory-migrations.js';

interface MemoryRow extends Record<string, SqliteValue> {
  id: string;
  scope: MemoryScope;
  workspace_key: string;
  workspace: string;
  kind: FactKind;
  text: string;
  tags: string;
  created_at: string;
  updated_at: string;
  confirmations: number;
  contradictions: number;
  active: number;
  deleted: number;
}

interface StrategyRow extends Record<string, SqliteValue> {
  id: string;
  scope: MemoryScope;
  workspace_key: string;
  workspace: string;
  payload: string;
}

interface NoteRow extends Record<string, SqliteValue> {
  contents: string;
}

function scopeKey(scope: MemoryScope, workspace: string): string {
  return scope === 'global' ? '' : workspaceKey(workspace);
}

function parseTags(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function factOf(row: MemoryRow): Fact {
  return {
    id: row.id,
    scope: row.scope,
    kind: row.kind,
    text: row.text,
    workspace: row.workspace,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmations: row.confirmations,
    contradictions: row.contradictions,
    tags: parseTags(row.tags),
  };
}

function stringValue(value: SqliteValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: SqliteValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseStrategy(row: StrategyRow): Strategy | null {
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return parsed && typeof parsed === 'object' ? parsed as Strategy : null;
  } catch {
    return null;
  }
}

export class MemoryRepository {
  readonly file: string;
  #database: SqliteDatabase;

  private constructor(database: SqliteDatabase) {
    this.#database = database;
    this.file = database.file;
  }

  static async open(file: string): Promise<MemoryRepository> {
    return new MemoryRepository(await SqliteDatabase.open(file, MEMORY_MIGRATIONS));
  }

  async close(): Promise<void> {
    await this.#database.close();
  }

  async facts(workspace: string, includeGlobal = true): Promise<Fact[]> {
    const rows = await this.#database.read((database) => {
      if (workspace === '') {
        return database.all<MemoryRow>(
          `SELECT * FROM memories WHERE active = 1 AND deleted = 0 AND scope = 'global' ORDER BY updated_at DESC`,
        );
      }
      const key = scopeKey('workspace', workspace);
      return database.all<MemoryRow>(
        `SELECT * FROM memories WHERE active = 1 AND deleted = 0
         AND (workspace_key = ?${includeGlobal ? " OR scope = 'global'" : ''})
         ORDER BY updated_at DESC`, [key],
      );
    });
    return rows.map(factOf);
  }

  async remember(input: {
    workspace: string;
    scope: MemoryScope;
    kind: FactKind;
    text: string;
    tags: readonly string[];
  }): Promise<Fact> {
    const key = scopeKey(input.scope, input.workspace);
    const workspace = input.scope === 'global' ? '' : input.workspace;
    const normalized = input.text.trim();
    return this.#database.transaction((database) => {
      const existing = database.get<MemoryRow>(
        `SELECT * FROM memories WHERE scope = ? AND workspace_key = ? AND kind = ? AND text = ? LIMIT 1`,
        [input.scope, key, input.kind, normalized],
      );
      const now = new Date().toISOString();
      if (existing) {
        const tags = [...new Set([...parseTags(existing.tags), ...input.tags])];
        database.run(
          `UPDATE memories SET updated_at = ?, confirmations = ?, tags = ?, active = 1, deleted = 0 WHERE id = ?`,
          [now, existing.confirmations + 1, JSON.stringify(tags), existing.id],
        );
        return factOf({ ...existing, updated_at: now, confirmations: existing.confirmations + 1, tags: JSON.stringify(tags), active: 1, deleted: 0 });
      }
      const fact: Fact = {
        id: randomUUID().slice(0, 8),
        scope: input.scope,
        kind: input.kind,
        text: normalized,
        workspace,
        createdAt: now,
        updatedAt: now,
        confirmations: 1,
        contradictions: 0,
        tags: input.tags,
      };
      database.run(
        `INSERT INTO memories
          (id, scope, workspace_key, workspace, kind, text, tags, created_at,
           updated_at, confirmations, contradictions, active, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
        [fact.id, fact.scope, key, fact.workspace, fact.kind, fact.text, JSON.stringify(fact.tags), fact.createdAt, fact.updatedAt, fact.confirmations, fact.contradictions],
      );
      return fact;
    });
  }

  async contradict(workspace: string, id: string): Promise<Fact | null> {
    const key = scopeKey('workspace', workspace);
    return this.#database.transaction((database) => {
      const target = database.get<MemoryRow>(
        `SELECT * FROM memories WHERE id = ? AND (workspace_key = ? OR scope = 'global') LIMIT 1`, [id, key],
      );
      if (!target) return null;
      const contradictions = target.contradictions + 1;
      const active = contradictions < 2 ? 1 : 0;
      const now = new Date().toISOString();
      database.run('UPDATE memories SET contradictions = ?, active = ?, updated_at = ? WHERE id = ?', [contradictions, active, now, id]);
      return factOf({ ...target, contradictions, active, updated_at: now });
    });
  }

  async strategies(workspace: string, includeGlobal = false): Promise<Strategy[]> {
    const key = scopeKey('workspace', workspace);
    const rows = await this.#database.read((database) => database.all<StrategyRow>(
      `SELECT * FROM strategies WHERE workspace_key = ?${includeGlobal ? " OR scope = 'global'" : ''} ORDER BY updated_at DESC`, [key],
    ));
    return rows.map(parseStrategy).filter((value): value is Strategy => value !== null);
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
    const key = scopeKey('workspace', input.workspace);
    const baseId = strategyIdValue(input.goal, input.approach);
    return this.#database.transaction((database) => {
      const selected = selectStrategy(database, baseId, key);
      const id = selected.id;
      const existing = selected.row;
      const now = new Date().toISOString();
      const outcome: Outcome = {
        ok: input.ok,
        at: now,
        context: input.context,
        sessionId: input.sessionId,
        ...(input.note ? { note: input.note } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      };
      const current = existing ? parseStrategy(existing) : null;
      const strategy: Strategy = current
        ? { ...current, outcomes: [...current.outcomes, outcome].slice(-40) }
        : {
            id,
            goal: input.goal,
            approach: input.approach,
            workspace: input.workspace,
            createdAt: now,
            outcomes: [outcome],
          };
      if (existing) {
        database.run('UPDATE strategies SET payload = ?, updated_at = ? WHERE id = ? AND workspace_key = ?', [JSON.stringify(strategy), now, id, key]);
      } else {
        database.run(
          'INSERT INTO strategies (id, scope, workspace_key, workspace, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, 'workspace', key, input.workspace, JSON.stringify(strategy), now, now],
        );
      }
      return strategy;
    });
  }

  async notes(workspace: string, includeGlobal = false): Promise<string> {
    const key = scopeKey('workspace', workspace);
    const rows = await this.#database.read((database) => database.all<NoteRow>(
      `SELECT contents FROM memory_notes WHERE workspace_key = ?${includeGlobal ? " OR scope = 'global'" : ''} ORDER BY scope`, [key],
    ));
    return rows.map((row) => row.contents).filter(Boolean).join('\n');
  }

  async writeNotes(workspace: string, contents: string, scope: MemoryScope = 'workspace'): Promise<void> {
    const key = scopeKey(scope, workspace);
    const owner = scope === 'global' ? '' : workspace;
    await this.#database.transaction((database) => {
      database.run(
        `INSERT INTO memory_notes (scope, workspace_key, workspace, contents, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scope, workspace_key) DO UPDATE SET contents = excluded.contents, updated_at = excluded.updated_at`,
        [scope, key, owner, contents, new Date().toISOString()],
      );
    });
  }

  async forget(workspace: string): Promise<void> {
    await this.#database.transaction((database) => {
      const key = scopeKey('workspace', workspace);
      database.run('DELETE FROM memories WHERE scope = ? AND workspace_key = ?', ['workspace', key]);
      database.run('DELETE FROM strategies WHERE scope = ? AND workspace_key = ?', ['workspace', key]);
      database.run('DELETE FROM memory_notes WHERE scope = ? AND workspace_key = ?', ['workspace', key]);
    });
  }

  async importLegacy(input: {
    workspace: string;
    facts: readonly Fact[];
    strategies: readonly Strategy[];
    notes: string;
  }): Promise<void> {
    const key = scopeKey('workspace', input.workspace);
    await this.#database.transaction((database) => {
      for (const fact of input.facts) {
        database.run(
          `INSERT OR IGNORE INTO memories
            (id, scope, workspace_key, workspace, kind, text, tags, created_at,
             updated_at, confirmations, contradictions, active, deleted)
           VALUES (?, 'workspace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [fact.id, key, input.workspace, fact.kind, fact.text, JSON.stringify(fact.tags), fact.createdAt, fact.updatedAt, fact.confirmations, fact.contradictions, fact.contradictions < 2 ? 1 : 0],
        );
      }
      for (const strategy of input.strategies) {
        const id = selectStrategy(database, strategy.id, key).id;
        const stored = id === strategy.id ? strategy : { ...strategy, id };
        database.run(
          `INSERT OR IGNORE INTO strategies (id, scope, workspace_key, workspace, payload, created_at, updated_at)
           VALUES (?, 'workspace', ?, ?, ?, ?, ?)`,
          [id, key, input.workspace, JSON.stringify(stored), strategy.createdAt, new Date().toISOString()],
        );
      }
      if (input.notes.trim()) {
        database.run(
          `INSERT OR IGNORE INTO memory_notes (scope, workspace_key, workspace, contents, updated_at)
           VALUES ('workspace', ?, ?, ?, ?)`, [key, input.workspace, input.notes, new Date().toISOString()],
        );
      }
    });
  }
}

function selectStrategy(database: SqliteStatement, baseId: string, key: string): { id: string; row: StrategyRow | null } {
  const namespacedId = `${baseId}:${key}`;
  const existingBase = database.get<StrategyRow>(
    'SELECT * FROM strategies WHERE id = ? AND workspace_key = ? LIMIT 1',
    [baseId, key],
  );
  if (existingBase) return { id: baseId, row: existingBase };

  const existingNamespaced = database.get<StrategyRow>(
    'SELECT * FROM strategies WHERE id = ? AND workspace_key = ? LIMIT 1',
    [namespacedId, key],
  );
  if (existingNamespaced) return { id: namespacedId, row: existingNamespaced };

  const baseTaken = database.get<StrategyRow>('SELECT id FROM strategies WHERE id = ? LIMIT 1', [baseId]);
  return { id: baseTaken ? namespacedId : baseId, row: null };
}

function strategyIdValue(goal: string, approach: string): string {
  return createHash('sha256').update(`${goal.trim()}\0${approach.trim()}`).digest('hex').slice(0, 12);
}
