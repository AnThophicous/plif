import type { SqliteMigration } from '../persistence/sqlite.js';

export const MEMORY_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        workspace TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmations INTEGER NOT NULL DEFAULT 1,
        contradictions INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS memories_scope_lookup
        ON memories(scope, workspace_key, active, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS memories_text_identity
        ON memories(scope, workspace_key, kind, text);
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        workspace TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS strategies_scope_lookup
        ON strategies(scope, workspace_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_notes (
        scope TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        workspace TEXT NOT NULL DEFAULT '',
        contents TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(scope, workspace_key)
      );
    `,
  },
];
