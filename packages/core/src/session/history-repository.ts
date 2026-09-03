import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type { SqliteValue } from '../persistence/sqlite.js';
import { SqliteDatabase } from '../persistence/sqlite.js';
import { decodeConversationEvent, eventBase } from './events.js';
import type { ConversationEvent } from './events.js';
import type { ConversationState } from '../model/conversation-state.js';
import type { SessionMeta } from './store.js';
import { HISTORY_MIGRATIONS } from './history-migrations.js';

interface SessionRow extends Record<string, SqliteValue> {
  id: string;
  compatibility_id: string;
  workspace: string;
  workspace_key: string;
  created_at: string;
  updated_at: string;
  title: string;
  turns: number;
  container: string | null;
  closed_at: string | null;
  parent_id: string | null;
  fork_checkpoint: number | null;
  provider_id: string | null;
  model_id: string | null;
  lifecycle: string;
}

interface EventRow extends Record<string, SqliteValue> {
  event_id: string;
  payload: string;
}

interface StateRow extends Record<string, SqliteValue> {
  payload: string;
  generation: number;
}

/** Tokens a turn consumed, as the provider reported them. */
export interface UsageDelta {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

/** One session, with whatever token usage was recorded against it. */
export interface SessionUsageRow {
  readonly sessionId: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turns: number;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface HistoryCheckpoint {
  readonly sessionId: string;
  readonly sequence: number;
  readonly snapshot: string;
  readonly createdAt: string;
}

export interface QueuedHistoryInput {
  readonly id: string;
  readonly sessionId: string;
  readonly text: string;
  readonly attachments?: readonly unknown[];
  readonly enqueuedAt: string;
  readonly deliverySequence?: number;
  readonly status: 'pending' | 'delivered' | 'cancelled';
}

export interface EnqueuedHistoryInput {
  readonly input: QueuedHistoryInput;
  readonly event: ConversationEvent;
}

function stringValue(value: SqliteValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: SqliteValue | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableString(value: SqliteValue | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function rowToMeta(row: SessionRow): SessionMeta {
  return {
    id: row.compatibility_id,
    uuid: row.id,
    workspace: row.workspace,
    workspaceKey: row.workspace_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    turns: row.turns,
    container: row.container,
    ...(row.closed_at ? { closedAt: row.closed_at } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    ...(row.fork_checkpoint !== null ? { forkCheckpoint: row.fork_checkpoint } : {}),
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.model_id ? { modelId: row.model_id } : {}),
    lifecycle: row.lifecycle,
  };
}

function sessionId(meta: SessionMeta): string {
  return meta.uuid ?? meta.id;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

function parseEvent(payload: string): ConversationEvent | null {
  try {
    return decodeConversationEvent(JSON.parse(payload));
  } catch {
    return null;
  }
}

function summarise(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 72 ? firstLine.slice(0, 71) + '…' : firstLine;
}

export class HistoryRepository {
  readonly file: string;
  #database: SqliteDatabase;

  private constructor(database: SqliteDatabase) {
    this.#database = database;
    this.file = database.file;
  }

  static async open(file: string): Promise<HistoryRepository> {
    return new HistoryRepository(await SqliteDatabase.open(file, HISTORY_MIGRATIONS));
  }

  async close(): Promise<void> {
    await this.#database.close();
  }

  async create(meta: SessionMeta): Promise<SessionMeta> {
    const id = sessionId(meta);
    await this.#database.transaction((database) => {
      database.run(
        `INSERT OR IGNORE INTO sessions
          (id, compatibility_id, workspace, workspace_key, created_at, updated_at,
           title, turns, container, closed_at, parent_id, fork_checkpoint,
           provider_id, model_id, lifecycle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          meta.id,
          meta.workspace,
          meta.workspaceKey ?? '',
          meta.createdAt,
          meta.updatedAt,
          meta.title,
          meta.turns,
          meta.container,
          meta.closedAt ?? null,
          meta.parentId ?? null,
          meta.forkCheckpoint ?? null,
          meta.providerId ?? null,
          meta.modelId ?? null,
          meta.lifecycle ?? 'active',
        ],
      );
    });
    return (await this.getById(meta.workspace, meta.id)) ?? meta;
  }

  async getById(workspace: string, ref: string): Promise<SessionMeta | null> {
    const row = await this.#database.read((database) => database.get<SessionRow>(
      `SELECT * FROM sessions
       WHERE workspace_key = ? AND (compatibility_id = ? OR id = ?)
       LIMIT 1`,
      [workspaceKeyValue(workspace), ref, ref],
    ));
    return row ? rowToMeta(row) : null;
  }

  async list(workspace: string): Promise<SessionMeta[]> {
    const rows = await this.#database.read((database) => database.all<SessionRow>(
      `SELECT * FROM sessions WHERE workspace_key = ? ORDER BY updated_at DESC`,
      [workspaceKeyValue(workspace)],
    ));
    return rows.map(rowToMeta);
  }

  async workspaces(): Promise<{ key: string; workspace: string; sessions: number }[]> {
    const rows = await this.#database.read((database) => database.all<SessionRow & { sessions: number }>(
      `SELECT workspace_key, workspace, COUNT(*) AS sessions
       FROM sessions GROUP BY workspace_key, workspace ORDER BY MAX(updated_at) DESC`,
    ));
    return rows.map((row) => ({
      key: row.workspace_key,
      workspace: row.workspace,
      sessions: numberValue(row.sessions),
    }));
  }

  async append(meta: SessionMeta, event: ConversationEvent): Promise<SessionMeta> {
    const id = sessionId(meta);
    await this.#database.transaction((database) => {
      const existingSession = database.get<SessionRow>(
        'SELECT * FROM sessions WHERE id = ? LIMIT 1',
        [id],
      );
      if (!existingSession) {
        database.run(
          `INSERT INTO sessions
            (id, compatibility_id, workspace, workspace_key, created_at, updated_at,
             title, turns, container, closed_at, parent_id, fork_checkpoint,
             provider_id, model_id, lifecycle)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            meta.id,
            meta.workspace,
            meta.workspaceKey ?? workspaceKeyValue(meta.workspace),
            meta.createdAt,
            meta.updatedAt,
            meta.title,
            meta.turns,
            meta.container,
            meta.closedAt ?? null,
            meta.parentId ?? null,
            meta.forkCheckpoint ?? null,
            meta.providerId ?? null,
            meta.modelId ?? null,
            meta.lifecycle ?? 'active',
          ],
        );
      }
      const duplicate = database.get<{ event_id: string }>(
        'SELECT event_id FROM events WHERE session_id = ? AND event_id = ? LIMIT 1',
        [id, event.eventId],
      );
      if (duplicate) return;
      const sequence = numberValue(database.get<{ sequence: number }>(
        'SELECT MAX(sequence) AS sequence FROM events WHERE session_id = ?',
        [id],
      )?.sequence) + 1;
      database.run(
        `INSERT INTO events (session_id, sequence, event_id, turn_id, kind, at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, sequence, event.eventId, event.turnId, event.kind, event.at, safeJson(event)],
      );
      const current = database.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
      if (!current) return;
      const title = current.title || (event.kind === 'user.message' ? summarise(event.text) : '');
      const turns = current.turns + (event.kind === 'user.message' ? 1 : 0);
      database.run(
        `UPDATE sessions SET updated_at = ?, title = ?, turns = ? WHERE id = ?`,
        [new Date().toISOString(), title, turns, id],
      );
    });
    return (await this.getById(meta.workspace, meta.id)) ?? meta;
  }

  async importEvents(meta: SessionMeta, events: readonly ConversationEvent[], source?: string): Promise<number> {
    if (events.length === 0) return 0;
    const id = sessionId(meta);
    return this.#database.transaction((database) => {
      const current = database.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
      if (!current) {
        database.run(
          `INSERT INTO sessions
            (id, compatibility_id, workspace, workspace_key, created_at, updated_at,
             title, turns, container, closed_at, parent_id, fork_checkpoint,
             provider_id, model_id, lifecycle)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, meta.id, meta.workspace, meta.workspaceKey ?? workspaceKeyValue(meta.workspace),
            meta.createdAt, meta.updatedAt, meta.title, meta.turns, meta.container,
            meta.closedAt ?? null, meta.parentId ?? null, meta.forkCheckpoint ?? null,
            meta.providerId ?? null, meta.modelId ?? null, meta.lifecycle ?? 'active'],
        );
      }
      if (source) {
        const marker = database.get<{ source: string }>('SELECT source FROM import_markers WHERE source = ?', [source]);
        if (marker) return 0;
      }
      let inserted = 0;
      let maxSequence = numberValue(database.get<{ sequence: number }>(
        'SELECT MAX(sequence) AS sequence FROM events WHERE session_id = ?', [id],
      )?.sequence);
      let turns = numberValue(database.get<SessionRow>('SELECT turns FROM sessions WHERE id = ?', [id])?.turns);
      let title = stringValue(database.get<SessionRow>('SELECT title FROM sessions WHERE id = ?', [id])?.title);
      for (const event of events) {
        const duplicate = database.get<{ event_id: string }>(
          'SELECT event_id FROM events WHERE session_id = ? AND event_id = ?', [id, event.eventId],
        );
        if (duplicate) continue;
        maxSequence += 1;
        database.run(
          `INSERT INTO events (session_id, sequence, event_id, turn_id, kind, at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, maxSequence, event.eventId, event.turnId, event.kind, event.at, safeJson(event)],
        );
        inserted += 1;
        if (event.kind === 'user.message') {
          turns += 1;
          if (!title) title = summarise(event.text);
        }
      }
      if (inserted > 0) {
        database.run(
          `UPDATE sessions SET updated_at = ?, title = ?, turns = ? WHERE id = ?`,
          [new Date().toISOString(), title, turns, id],
        );
      }
      if (source) {
        database.run(
          'INSERT OR REPLACE INTO import_markers (source, imported_at, event_count) VALUES (?, ?, ?)',
          [source, new Date().toISOString(), inserted],
        );
      }
      return inserted;
    });
  }

  async events(meta: SessionMeta): Promise<ConversationEvent[]> {
    const id = sessionId(meta);
    const rows = await this.#database.read((database) => database.all<EventRow>(
      'SELECT event_id, payload FROM events WHERE session_id = ? ORDER BY sequence', [id],
    ));
    const output: ConversationEvent[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.event_id)) continue;
      const event = parseEvent(row.payload);
      if (!event) continue;
      seen.add(row.event_id);
      output.push(event);
    }
    return output;
  }

  /**
   * Add a turn's tokens to this session's running totals.
   *
   * Accumulated rather than replaced: a turn reports what it used, and the
   * session is the sum of its turns. Keyed by model as well, so switching
   * models mid-session keeps the two apart instead of blending them.
   */
  async recordUsage(meta: SessionMeta, modelId: string, delta: UsageDelta): Promise<void> {
    const input = Math.max(0, Math.trunc(delta.inputTokens ?? 0));
    const output = Math.max(0, Math.trunc(delta.outputTokens ?? 0));
    const cacheRead = Math.max(0, Math.trunc(delta.cacheReadTokens ?? 0));
    const cacheWrite = Math.max(0, Math.trunc(delta.cacheWriteTokens ?? 0));
    if (input + output + cacheRead + cacheWrite === 0) return;
    const id = sessionId(meta);
    await this.#database.transaction((database) => {
      database.run(
        `INSERT INTO session_usage
           (session_id, model_id, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, model_id) DO UPDATE SET
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
           cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
           updated_at = excluded.updated_at`,
        [id, modelId, input, output, cacheRead, cacheWrite, new Date().toISOString()],
      );
    });
  }

  /**
   * Every session in the store, with its usage, across all workspaces.
   *
   * A left join, so sessions recorded before usage was tracked still count
   * towards days, streaks and session length - they simply contribute no
   * tokens rather than disappearing from the history.
   */
  async usageRows(): Promise<SessionUsageRow[]> {
    interface Row extends Record<string, SqliteValue> {
      id: string;
      workspace: string;
      created_at: string;
      updated_at: string;
      turns: number;
      session_model: string | null;
      usage_model: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
    }
    const rows = await this.#database.read((database) => database.all<Row>(
      `SELECT s.id, s.workspace, s.created_at, s.updated_at, s.turns,
              s.model_id AS session_model,
              u.model_id AS usage_model,
              u.input_tokens, u.output_tokens,
              u.cache_read_tokens, u.cache_write_tokens
       FROM sessions s
       LEFT JOIN session_usage u ON u.session_id = s.id
       ORDER BY s.created_at ASC`,
    ));
    return rows.map((row) => ({
      sessionId: row.id,
      workspace: row.workspace,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turns: numberValue(row.turns),
      modelId: row.usage_model || row.session_model || '',
      inputTokens: numberValue(row.input_tokens ?? 0),
      outputTokens: numberValue(row.output_tokens ?? 0),
      cacheReadTokens: numberValue(row.cache_read_tokens ?? 0),
      cacheWriteTokens: numberValue(row.cache_write_tokens ?? 0),
    }));
  }

  async rename(meta: SessionMeta, title: string): Promise<SessionMeta> {
    const id = sessionId(meta);
    await this.#database.transaction((database) => {
      database.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [title.trim().slice(0, 160), new Date().toISOString(), id]);
    });
    return (await this.getById(meta.workspace, meta.id)) ?? meta;
  }

  async closeSession(meta: SessionMeta): Promise<SessionMeta> {
    const id = sessionId(meta);
    await this.#database.transaction((database) => {
      const now = new Date().toISOString();
      database.run('UPDATE sessions SET closed_at = ?, lifecycle = ?, updated_at = ? WHERE id = ?', [now, 'closed', now, id]);
    });
    return (await this.getById(meta.workspace, meta.id)) ?? meta;
  }

  async remove(meta: SessionMeta): Promise<void> {
    await this.#database.transaction((database) => {
      database.run('DELETE FROM sessions WHERE id = ?', [sessionId(meta)]);
    });
  }

  async checkpoint(meta: SessionMeta, sequence: number, snapshot: string): Promise<HistoryCheckpoint> {
    const checkpoint: HistoryCheckpoint = {
      sessionId: sessionId(meta),
      sequence,
      snapshot,
      createdAt: new Date().toISOString(),
    };
    await this.#database.transaction((database) => {
      database.run(
        'INSERT INTO checkpoints (session_id, sequence, snapshot, created_at) VALUES (?, ?, ?, ?)',
        [checkpoint.sessionId, checkpoint.sequence, checkpoint.snapshot, checkpoint.createdAt],
      );
    });
    return checkpoint;
  }

  async latestCheckpoint(meta: SessionMeta): Promise<HistoryCheckpoint | null> {
    const row = await this.#database.read((database) => database.get<{ session_id: string; sequence: number; snapshot: string; created_at: string }>(
      `SELECT session_id, sequence, snapshot, created_at FROM checkpoints
       WHERE session_id = ? ORDER BY sequence DESC, id DESC LIMIT 1`, [sessionId(meta)],
    ));
    return row ? { sessionId: row.session_id, sequence: row.sequence, snapshot: row.snapshot, createdAt: row.created_at } : null;
  }

  async enqueueInput(meta: SessionMeta, text: string, attachments: readonly unknown[] = []): Promise<EnqueuedHistoryInput> {
    const input: QueuedHistoryInput = {
      id: randomUUID(),
      sessionId: sessionId(meta),
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
      enqueuedAt: new Date().toISOString(),
      status: 'pending',
    };
    const event: ConversationEvent = {
      ...eventBase('queued.input', `queue:${input.id}`, input.enqueuedAt),
      inputId: input.id,
      text: input.text,
    };
    await this.#database.transaction((database) => {
      database.run(
        `INSERT INTO queued_inputs (id, session_id, text, attachments, enqueued_at, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.id, input.sessionId, input.text, input.attachments ? safeJson(input.attachments) : null, input.enqueuedAt, input.status],
      );
      const sequence = numberValue(database.get<{ sequence: number }>(
        'SELECT MAX(sequence) AS sequence FROM events WHERE session_id = ?',
        [input.sessionId],
      )?.sequence) + 1;
      database.run(
        `INSERT INTO events (session_id, sequence, event_id, turn_id, kind, at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.sessionId, sequence, event.eventId, event.turnId, event.kind, event.at, safeJson(event)],
      );
      database.run(
        'UPDATE sessions SET updated_at = ? WHERE id = ?',
        [event.at, input.sessionId],
      );
    });
    return { input, event };
  }

  async deliverInput(meta: SessionMeta, inputId: string, event: ConversationEvent): Promise<SessionMeta | null> {
    const id = sessionId(meta);
    const delivered = await this.#database.transaction((database) => {
      const queued = database.get<{ status: string }>(
        'SELECT status FROM queued_inputs WHERE id = ? AND session_id = ? LIMIT 1',
        [inputId, id],
      );
      if (!queued || queued.status !== 'pending') return false;
      const current = database.get<SessionRow>('SELECT * FROM sessions WHERE id = ? LIMIT 1', [id]);
      if (!current) return false;
      const existing = database.get<{ sequence: number }>(
        'SELECT sequence FROM events WHERE session_id = ? AND event_id = ? LIMIT 1',
        [id, event.eventId],
      );
      const sequence = existing?.sequence ?? numberValue(database.get<{ sequence: number }>(
        'SELECT MAX(sequence) AS sequence FROM events WHERE session_id = ?', [id],
      )?.sequence) + 1;
      if (!existing) {
        database.run(
          `INSERT INTO events (session_id, sequence, event_id, turn_id, kind, at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, sequence, event.eventId, event.turnId, event.kind, event.at, safeJson(event)],
        );
        const title = current.title || (event.kind === 'user.message' ? summarise(event.text) : '');
        const turns = current.turns + (event.kind === 'user.message' ? 1 : 0);
        database.run(
          'UPDATE sessions SET updated_at = ?, title = ?, turns = ? WHERE id = ?',
          [new Date().toISOString(), title, turns, id],
        );
      }
      database.run(
        'UPDATE queued_inputs SET status = ?, delivery_sequence = ? WHERE id = ? AND status = ?',
        ['delivered', sequence, inputId, 'pending'],
      );
      return true;
    });
    return delivered ? (await this.getById(meta.workspace, meta.id)) ?? meta : null;
  }

  async pendingInputs(meta: SessionMeta): Promise<QueuedHistoryInput[]> {
    const rows = await this.#database.read((database) => database.all<Record<string, SqliteValue>>(
      `SELECT id, session_id, text, attachments, enqueued_at, delivery_sequence, status
       FROM queued_inputs WHERE session_id = ? AND status = 'pending' ORDER BY enqueued_at, id`, [sessionId(meta)],
    ));
    return rows.map((row) => {
      let attachments: readonly unknown[] | undefined;
      if (typeof row.attachments === 'string') {
        try {
          const parsed: unknown = JSON.parse(row.attachments);
          if (Array.isArray(parsed)) attachments = parsed;
        } catch {
          attachments = undefined;
        }
      }
      return {
        id: stringValue(row.id),
        sessionId: stringValue(row.session_id),
        text: stringValue(row.text),
        ...(attachments ? { attachments } : {}),
        enqueuedAt: stringValue(row.enqueued_at),
        ...(typeof row.delivery_sequence === 'number' ? { deliverySequence: row.delivery_sequence } : {}),
        status: stringValue(row.status, 'pending') as QueuedHistoryInput['status'],
      };
    });
  }

  async markInputDelivered(id: string, sequence: number): Promise<void> {
    await this.#database.transaction((database) => {
      database.run('UPDATE queued_inputs SET status = ?, delivery_sequence = ? WHERE id = ?', ['delivered', sequence, id]);
    });
  }

  async saveConversationState(meta: SessionMeta, state: ConversationState): Promise<void> {
    const id = sessionId(meta);
    await this.#database.transaction((database) => {
      const current = database.get<StateRow>('SELECT payload, generation FROM session_state WHERE session_id = ?', [id]);
      if (current && current.generation > state.generation) return;
      database.run(
        `INSERT INTO session_state (session_id, generation, payload, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET generation = excluded.generation,
           payload = excluded.payload, updated_at = excluded.updated_at`,
        [id, state.generation, safeJson(state), state.updatedAt],
      );
    });
  }

  async loadConversationState(meta: SessionMeta): Promise<ConversationState | null> {
    const row = await this.#database.read((database) => database.get<StateRow>('SELECT payload FROM session_state WHERE session_id = ?', [sessionId(meta)]));
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as ConversationState;
    } catch {
      return null;
    }
  }

  async clearConversationState(meta: SessionMeta): Promise<void> {
    await this.#database.transaction((database) => {
      database.run('DELETE FROM session_state WHERE session_id = ?', [sessionId(meta)]);
    });
  }
}

function workspaceKeyValue(workspace: string): string {
  let value = path.resolve(workspace);
  if (process.platform === 'win32') value = value.toLowerCase();
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
