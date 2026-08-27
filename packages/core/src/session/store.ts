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
import {
  adaptLegacyTranscriptEvent,
  decodeConversationEvent,
  decodeLegacyTranscriptEvent,
  dedupeConversationEvents,
} from './events.js';
import type {
  ConversationEvent,
  LegacyTranscriptEvent,
} from './events.js';
import {
  isConversationState,
  type ConversationState,
} from '../model/conversation-state.js';

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
/** Compatibility input while callers migrate; the store always writes v1. */
export type TranscriptEvent = ConversationEvent | LegacyTranscriptEvent;

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
  #legacyTurnId: string | null = null;
  #legacyEvent = 0;

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
      this.#meta = await this.#store.appendTo(this.#meta, this.#canonical(event));
    });
    return this.#queue;
  }

  #canonical(event: TranscriptEvent): ConversationEvent {
    const canonical = decodeConversationEvent(event);
    if (canonical) return canonical;
    const legacy = decodeLegacyTranscriptEvent(event);
    if (!legacy) {
      throw new PlifError('INVALID_ARGUMENT', 'session event is malformed');
    }
    if (legacy.kind === 'user' || !this.#legacyTurnId) this.#legacyTurnId = randomUUID();
    const adapted = adaptLegacyTranscriptEvent(legacy, {
      turnId: this.#legacyTurnId,
      nextEventId: () => `${this.#meta.id}:legacy-live:${++this.#legacyEvent}`,
    });
    if (!adapted) throw new PlifError('INVALID_ARGUMENT', 'session event could not be adapted');
    return adapted;
  }

  /** Flush pending appends, then mark the conversation finished. */
  async close(): Promise<void> {
    await this.#queue;
    this.#meta = await this.#store.closeMeta(this.#meta);
  }

  /** Give a session a human title without touching its append-only transcript. */
  async rename(title: string): Promise<void> {
    await this.#queue;
    this.#meta = await this.#store.renameMeta(this.#meta, title);
  }

  read(): AsyncGenerator<ConversationEvent> {
    return this.#store.read(this.#meta);
  }

  replay(): Promise<ConversationEvent[]> {
    return this.#store.replay(this.#meta);
  }

  /** Read every stored event for human-visible history, including compacted turns. */
  history(): Promise<ConversationEvent[]> {
    return this.#store.history(this.#meta);
  }

  /** Load the provider-native continuation pointer, if this session has one. */
  async loadConversationState(): Promise<ConversationState | null> {
    await this.#queue;
    return this.#store.loadConversationState(this.#meta);
  }

  /** Persist only the non-secret continuation pointer after a successful turn. */
  saveConversationState(state: ConversationState): Promise<void> {
    this.#queue = this.#queue.then(() => this.#store.saveConversationState(this.#meta, state));
    return this.#queue;
  }

  /** Remove a stale native pointer so the next turn uses transcript replay. */
  clearConversationState(): Promise<void> {
    this.#queue = this.#queue.then(() => this.#store.clearConversationState(this.#meta));
    return this.#queue;
  }
}

export class SessionStore {
  #paths: StorePaths;

  constructor(paths: StorePaths) {
    this.#paths = paths;
  }

  /** Root of the global store, for auxiliary metadata kept outside sessions. */
  get root(): string {
    return this.#paths.root;
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

  #conversationStateFile(workspace: string, id: string): string {
    return path.join(this.#dir(workspace), `${id}.state.json`);
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

  async loadConversationState(meta: SessionMeta): Promise<ConversationState | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.#conversationStateFile(meta.workspace, meta.id), 'utf8')) as unknown;
      return isConversationState(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  async saveConversationState(meta: SessionMeta, state: ConversationState): Promise<void> {
    if (!isConversationState(state)) {
      throw new PlifError('INVALID_ARGUMENT', 'conversation state is malformed');
    }
    const safe: ConversationState = {
      version: 1,
      scope: {
        providerId: state.scope.providerId,
        model: state.scope.model,
        endpoint: state.scope.endpoint,
        ...(state.scope.protocol ? { protocol: state.scope.protocol } : {}),
        ...(state.scope.account ? { account: state.scope.account } : {}),
      },
      mode: state.mode,
      kind: state.kind,
      ...(state.threadId ? { threadId: state.threadId } : {}),
      ...(state.previousResponseId ? { previousResponseId: state.previousResponseId } : {}),
      ...(state.lastTurnId ? { lastTurnId: state.lastTurnId } : {}),
      generation: state.generation,
      updatedAt: state.updatedAt,
      ...(state.lastFallbackReason ? { lastFallbackReason: state.lastFallbackReason } : {}),
    };
    await fs.mkdir(this.#dir(meta.workspace), { recursive: true });
    const target = this.#conversationStateFile(meta.workspace, meta.id);
    const current = await this.loadConversationState(meta);
    if (current && current.generation > safe.generation) return;
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let committed = false;
    try {
      await fs.writeFile(temp, JSON.stringify(safe, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temp, target);
      committed = true;
    } finally {
      if (!committed) await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }

  async clearConversationState(meta: SessionMeta): Promise<void> {
    await fs.rm(this.#conversationStateFile(meta.workspace, meta.id), { force: true });
  }

  /**
   * Append one event and bump the derived metadata.
   *
   * Internal: go through `Session.append` instead, which owns the returned
   * metadata so it cannot be dropped on the floor.
   */
  async appendTo(meta: SessionMeta, event: ConversationEvent): Promise<SessionMeta> {
    await fs.mkdir(this.#dir(meta.workspace), { recursive: true });
    await fs.appendFile(
      this.#transcriptFile(meta.workspace, meta.id),
      JSON.stringify(event) + '\n',
      'utf8',
    );

    const next: SessionMeta = {
      ...meta,
      updatedAt: new Date().toISOString(),
      turns: event.kind === 'user.message' ? meta.turns + 1 : meta.turns,
      // The first thing the developer said is the best label available, and it
      // is more useful than any title a model would invent for it.
      title: meta.title || (event.kind === 'user.message' ? summarise(event.text) : ''),
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

  /** Internal: metadata-only mutation used by the session browser. */
  async renameMeta(meta: SessionMeta, title: string): Promise<SessionMeta> {
    const next = { ...meta, title: title.trim().slice(0, 160) };
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
      if (!file.endsWith('.json') || file.endsWith('.state.json')) continue;
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
  async *read(meta: SessionMeta): AsyncGenerator<ConversationEvent> {
    const file = this.#transcriptFile(meta.workspace, meta.id);
    try {
      await fs.access(file);
    } catch {
      return;
    }

    const stream = createReadStream(file, 'utf8');
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let pending: { line: string; number: number } | null = null;
    let lineNumber = 0;
    let legacyTurn = '';
    let legacyTurns = 0;

    const decodeLine = (
      line: string,
      number: number,
      final: boolean,
    ): ConversationEvent | null => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return final
          ? null
          : {
              version: 1,
              eventId: `${meta.id}:malformed:${number}`,
              turnId: legacyTurn || `${meta.id}:recovery`,
              at: meta.updatedAt,
              kind: 'notice.recorded',
              level: 'warn',
              text: `Skipped malformed transcript line ${number}.`,
            };
      }

      const canonical = decodeConversationEvent(value);
      if (canonical) {
        legacyTurn = canonical.turnId;
        return canonical;
      }

      const legacy = decodeLegacyTranscriptEvent(value);
      if (!legacy) {
        return final
          ? null
          : {
              version: 1,
              eventId: `${meta.id}:malformed:${number}`,
              turnId: legacyTurn || `${meta.id}:recovery`,
              at: meta.updatedAt,
              kind: 'notice.recorded',
              level: 'warn',
              text: `Skipped malformed transcript line ${number}.`,
            };
      }
      if (legacy.kind === 'user' || !legacyTurn) {
        legacyTurns += 1;
        legacyTurn = `${meta.id}:legacy:${legacyTurns}`;
      }
      return adaptLegacyTranscriptEvent(legacy, {
        turnId: legacyTurn,
        nextEventId: () => `${meta.id}:legacy-line:${number}`,
      });
    };
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        lineNumber += 1;
        if (pending) {
          const event = decodeLine(pending.line, pending.number, false);
          if (event) yield event;
        }
        pending = { line, number: lineNumber };
      }
      if (pending) {
        const event = decodeLine(pending.line, pending.number, true);
        if (event) yield event;
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
  async replay(meta: SessionMeta): Promise<ConversationEvent[]> {
    const unique = await this.history(meta);
    const lastCompaction = unique.map((event) => event.kind).lastIndexOf('compaction.completed');
    return lastCompaction === -1 ? unique : unique.slice(lastCompaction);
  }

  /**
   * Read the complete append-only transcript without applying the model's
   * compaction boundary. The UI needs this so `/sessions` can show the whole
   * conversation; `replay()` remains intentionally smaller for model context.
   */
  async history(meta: SessionMeta): Promise<ConversationEvent[]> {
    const all: ConversationEvent[] = [];
    for await (const event of this.read(meta)) all.push(event);
    return dedupeConversationEvents(all);
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
        files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json') && !file.endsWith('.state.json'));
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
