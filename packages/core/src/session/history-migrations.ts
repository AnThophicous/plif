import type { SqliteMigration } from '../persistence/sqlite.js';

export const HISTORY_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        compatibility_id TEXT NOT NULL UNIQUE,
        workspace TEXT NOT NULL,
        workspace_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        turns INTEGER NOT NULL DEFAULT 0,
        container TEXT,
        closed_at TEXT,
        parent_id TEXT,
        fork_checkpoint INTEGER,
        provider_id TEXT,
        model_id TEXT,
        lifecycle TEXT NOT NULL DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS sessions_workspace_updated
        ON sessions(workspace_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS events (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(session_id, sequence),
        UNIQUE(session_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS events_session_sequence
        ON events(session_id, sequence);
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS checkpoints_session_sequence
        ON checkpoints(session_id, sequence DESC);
      CREATE TABLE IF NOT EXISTS session_state (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS queued_inputs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        attachments TEXT,
        enqueued_at TEXT NOT NULL,
        delivery_sequence INTEGER,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS queued_inputs_pending
        ON queued_inputs(session_id, status, enqueued_at);
      CREATE TABLE IF NOT EXISTS import_markers (
        source TEXT PRIMARY KEY,
        imported_at TEXT NOT NULL,
        event_count INTEGER NOT NULL
      );
    `,
  },
  {
    // Cumulative token usage, kept beside the session rather than inside it.
    //
    // A separate table because usage is per model as well as per session: a
    // session that switched models halfway is two rows, which is what lets the
    // stats screen show a per-model split instead of one blended figure. It is
    // also purely additive, so a store written by an older build stays
    // readable and simply reports nothing for the sessions that predate it.
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS session_usage (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, model_id)
      );
      CREATE INDEX IF NOT EXISTS session_usage_session ON session_usage(session_id);
    `,
  },
];
