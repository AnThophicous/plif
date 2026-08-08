/**
 * Sessions: conversations that survive the process that created them.
 *
 * A session is scoped to a **workspace**, meaning the directory the developer
 * was in when they started talking. Run `plif` in `~/Projetos/Callback`, have a
 * conversation, close the terminal, come back tomorrow, run `plif continue`,
 * and you are back in that conversation. Run it in a different project and you
 * get that project's history instead, not a global soup of every conversation
 * you have ever had.
 *
 * ## Why the store is global but sessions are scoped
 *
 * The store lives at `~/.plif`, not in a `.plif` folder inside each project.
 * Two reasons:
 *
 *   1. Layers deduplicate across projects. Six repositories that all use the
 *      same Node toolchain layer store it once, not six times. A per-project
 *      store throws that away, which is most of what makes layers cheap.
 *   2. Nobody wants a `.plif` directory appearing in every repo they touch,
 *      and nobody wants to add one to every `.gitignore`.
 *
 * Sessions are then keyed by a hash of the workspace path, so scoping is a
 * lookup rather than a scan.
 *
 * ## Why the transcript is JSONL
 *
 * It is appended to after every turn and never rewritten. A crash mid-session
 * costs the last line, not the conversation — which is the whole point of
 * being able to resume. A single JSON document would have to be rewritten
 * whole on each turn, and a crash during that write loses everything.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { PlifError } from '../errors.js';
import type { StorePaths } from '../store/paths.js';

// ---------------------------------------------------------------------------
// Transcript events
// ---------------------------------------------------------------------------

/**
 * One line of a transcript.
 *
 * Deliberately a flat union rather than a nested structure: the file is read
 * line by line, and a schema where a line's meaning depends on an earlier line
 * cannot be resumed from a truncated file.
 */
export type TranscriptEvent =
  | { readonly kind: 'user'; readonly at: string; readonly text: string }
  | { readonly kind: 'assistant'; readonly at: string; readonly text: string }
  | {
      readonly kind: 'tool';
      readonly at: string;
      readonly tool: string;
      readonly input: Record<string, unknown>;
      readonly output: string;
      readonly ok: boolean;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'note';
      readonly at: string;
      readonly text: string;
      readonly level: 'info' | 'warn' | 'error';
    }
  /**
   * A compaction boundary. Everything before it has been summarised into
   * `summary`; a resume replays the summary instead of the raw events, but the
   * raw events stay on disk so a human can always read what really happened.
   */
  | {
      readonly kind: 'compaction';
      readonly at: string;
      readonly summary: string;
      readonly replacedEvents: number;
    };

export interface SessionMeta {
  readonly id: string;
  /** Absolute workspace path, as typed. Kept for display and for verification. */
  readonly workspace: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** First user message, trimmed. What `plif sessions` shows as the label. */
  readonly title: string;
  readonly turns: number;
  /** Container this session was working in, if any. */
  readonly container: string | null;
  /** Set when the session ended cleanly; absent means it was interrupted. */
  readonly closedAt?: string;
}

/** Stable key for a workspace directory. */
export function workspaceKey(workspace: string): string {
  let normalized = path.resolve(workspace);
  // Windows paths are case-insensitive, so `C:\Proj` and `c:\proj` are the same
  // workspace and must hash the same. On POSIX they are genuinely different.
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * A live handle on one conversation.
 *
 * This exists because the earlier shape — `append(meta, event)` returning a new
 * `meta` for the caller to thread through — was a footgun, and it went off
 * almost immediately: a caller appended twice, discarded the first return
 * value, and the second write rolled the metadata back to a stale copy. The
 * session ended up recorded with zero turns and no title while its transcript
 * plainly contained both.
 *
 * Owning the metadata inside the handle makes that mistake unrepresentable.
 * Appends are also serialised here, so two overlapping writes cannot interleave
 * their metadata updates.
 */
export class Session {
  #store: SessionStore;
  #meta: SessionMeta;
  #queue: Promise<void> = Promise.resolve();

  constructor(store: SessionStore, meta: SessionMeta) {
    this.#store = store;
    this.#meta = meta;
  }

  get meta(): SessionMeta {
    return this.#meta;
  }

  get id(): string {
    return this.#meta.id;
  }

  get workspace(): string {
    return this.#meta.workspace;
  }

  /** Append one event. Safe to call concurrently. */
  append(event: TranscriptEvent): Promise<void> {
    this.#queue = this.#queue.then(async () => {
      this.#meta = await this.#store.appendTo(this.#meta, event);
    });
    return this.#queue;
  }

  /** Flush pending appends, then mark the conversation finished. */
  async close(): Promise<void> {
    await this.#queue;
    this.#meta = await this.#store.closeMeta(this.#meta);
  }

  read(): AsyncGenerator<TranscriptEvent> {
    return this.#store.read(this.#meta);
  }

  replay(): Promise<TranscriptEvent[]> {
    return this.#store.replay(this.#meta);
  }
}

export class SessionStore {
  #paths: StorePaths;

  constructor(paths: StorePaths) {
    this.#paths = paths;
  }

  #dir(workspace: string): string {
    return path.join(this.#paths.sessions, workspaceKey(workspace));
  }

  #metaFile(workspace: string, id: string): string {
    return path.join(this.#dir(workspace), `${id}.json`);
  }

  #transcriptFile(workspace: string, id: string): string {
    return path.join(this.#dir(workspace), `${id}.jsonl`);
  }

  /** Start a new session in this workspace. */
  async create(workspace: string, options: { container?: string } = {}): Promise<Session> {
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: randomUUID().replace(/-/g, '').slice(0, 12),
      workspace: path.resolve(workspace),
      createdAt: now,
      updatedAt: now,
      title: '',
      turns: 0,
      container: options.container ?? null,
    };
    await fs.mkdir(this.#dir(workspace), { recursive: true });
    await this.#writeMeta(meta);
    return new Session(this, meta);
  }

  async #writeMeta(meta: SessionMeta): Promise<void> {
    const target = this.#metaFile(meta.workspace, meta.id);
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, JSON.stringify(meta, null, 2), 'utf8');
    await fs.rename(temp, target);
  }

  /**
   * Append one event and bump the derived metadata.
   *
   * Internal: go through `Session.append` instead, which owns the returned
   * metadata so it cannot be dropped on the floor.
   */
  async appendTo(meta: SessionMeta, event: TranscriptEvent): Promise<SessionMeta> {
    await fs.mkdir(this.#dir(meta.workspace), { recursive: true });
    await fs.appendFile(
      this.#transcriptFile(meta.workspace, meta.id),
      JSON.stringify(event) + '\n',
      'utf8',
    );

    const next: SessionMeta = {
      ...meta,
      updatedAt: new Date().toISOString(),
      turns: event.kind === 'user' ? meta.turns + 1 : meta.turns,
      // The first thing the developer said is the best label available, and it
      // is more useful than any title a model would invent for it.
      title: meta.title || (event.kind === 'user' ? summarise(event.text) : ''),
    };
    await this.#writeMeta(next);
    return next;
  }

  /** Internal: use `Session.close`. */
  async closeMeta(meta: SessionMeta): Promise<SessionMeta> {
    const next = { ...meta, closedAt: new Date().toISOString() };
    await this.#writeMeta(next);
    return next;
  }

  /** Every session recorded for this workspace, newest activity first. */
  async list(workspace: string): Promise<SessionMeta[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.#dir(workspace));
    } catch {
      return [];
    }

    const sessions: SessionMeta[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.#dir(workspace), file), 'utf8');
        sessions.push(JSON.parse(raw) as SessionMeta);
      } catch {
        // A half-written meta file from a crash. Skip it rather than refusing
        // to list the sessions that are fine.
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** The session `plif continue` should resume: most recently touched. */
  async latest(workspace: string): Promise<Session | null> {
    const sessions = await this.list(workspace);
    const meta = sessions[0];
    return meta ? new Session(this, meta) : null;
  }

  /** Look up by full id or unambiguous prefix, within this workspace. */
  async resolve(workspace: string, ref: string): Promise<Session | null> {
    const sessions = await this.list(workspace);
    const exact = sessions.find((session) => session.id === ref);
    if (exact) return new Session(this, exact);

    const matches = sessions.filter((session) => session.id.startsWith(ref));
    if (matches.length === 1) return new Session(this, matches[0] as SessionMeta);
    if (matches.length > 1) {
      throw new PlifError('INVALID_ARGUMENT', `session id "${ref}" is ambiguous`, {
        detail: { candidates: matches.map((session) => session.id) },
        hint: 'Use more characters of the id.',
      });
    }
    return null;
  }

  /**
   * Stream a session's transcript.
   *
   * A corrupt line is skipped rather than aborting the read: a partial
   * transcript still resumes, and refusing to open a session because its last
   * line was truncated by a crash would defeat the purpose.
   */
  async *read(meta: SessionMeta): AsyncGenerator<TranscriptEvent> {
    const file = this.#transcriptFile(meta.workspace, meta.id);
    try {
      await fs.access(file);
    } catch {
      return;
    }

    const stream = createReadStream(file, 'utf8');
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as TranscriptEvent;
        } catch {
          // truncated or corrupt line
        }
      }
    } finally {
      lines.close();
      stream.close();
    }
  }

  /**
   * The events a resume should replay.
   *
   * Reads from the last compaction boundary onward, so resuming a long session
   * costs the summary plus recent turns rather than the entire history. The
   * events before the boundary remain on disk and readable — compaction shrinks
   * what the model is given, never what the human can audit.
   */
  async replay(meta: SessionMeta): Promise<TranscriptEvent[]> {
    const all: TranscriptEvent[] = [];
    for await (const event of this.read(meta)) all.push(event);

    const lastCompaction = all.map((event) => event.kind).lastIndexOf('compaction');
    return lastCompaction === -1 ? all : all.slice(lastCompaction);
  }

  async remove(meta: SessionMeta): Promise<void> {
    await fs.rm(this.#metaFile(meta.workspace, meta.id), { force: true });
    await fs.rm(this.#transcriptFile(meta.workspace, meta.id), { force: true });
  }

  /** Workspaces that have sessions, for a future `plif sessions --all`. */
  async workspaces(): Promise<{ key: string; workspace: string; sessions: number }[]> {
    let keys: string[];
    try {
      keys = await fs.readdir(this.#paths.sessions);
    } catch {
      return [];
    }

    const out: { key: string; workspace: string; sessions: number }[] = [];
    for (const key of keys) {
      const dir = path.join(this.#paths.sessions, key);
      let files: string[];
      try {
        files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json'));
      } catch {
        continue;
      }
      if (files.length === 0) continue;
      try {
        const raw = await fs.readFile(path.join(dir, files[0] as string), 'utf8');
        const meta = JSON.parse(raw) as SessionMeta;
        out.push({ key, workspace: meta.workspace, sessions: files.length });
      } catch {
        // unreadable; skip
      }
    }
    return out;
  }
}

/** First line, trimmed to something that fits a list column. */
function summarise(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 72 ? firstLine.slice(0, 71) + '…' : firstLine;
}
