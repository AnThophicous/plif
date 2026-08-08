/**
 * Append-only audit log.
 *
 * Every policy decision, every exec, every container transition lands here as
 * one JSON object per line. Two properties make it worth the write cost:
 *
 *   1. It is the answer to "what did the agent actually do last night?" —
 *      the question that decides whether a team is willing to let a loop run.
 *   2. Records are hash-chained. Each entry carries the digest of the previous
 *      one, so a tampered or excised line breaks verification at that point.
 *      This does not stop an attacker who owns the machine from rewriting the
 *      whole file, but it does stop selective edits, which is the realistic
 *      case: an agent (or a bug) quietly dropping the record of one bad action.
 *
 * Writes are queued and serialised. Concurrent appends to the same line-based
 * file from multiple async callers would otherwise interleave partial lines and
 * corrupt exactly the record you most want to read.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';

import type { Decision, PolicyAction } from '../policy/policy.js';
import type { StorePaths } from '../store/paths.js';

export type AuditEventType =
  | 'container.create'
  | 'container.start'
  | 'container.stop'
  | 'container.remove'
  | 'container.commit'
  | 'policy.decision'
  | 'approval.request'
  | 'approval.response'
  | 'exec.start'
  | 'exec.end'
  | 'fs.write'
  | 'fs.delete'
  | 'limit.exceeded'
  | 'sandbox.degraded'
  | 'agent.turn'
  | 'agent.tool';

export interface AuditRecord {
  /** Monotonic within a file, restarts per day. */
  readonly seq: number;
  readonly at: string;
  readonly type: AuditEventType;
  readonly containerId: string | null;
  /** Free-form payload. Keep it small — this file is read linearly. */
  readonly data: Record<string, unknown>;
  /** sha256 of the previous record's `hash`, plus this record's body. */
  readonly hash: string;
  readonly prev: string;
}

export interface PolicyDecisionData extends Record<string, unknown> {
  readonly action: PolicyAction;
  readonly target: string;
  readonly decision: Decision;
  readonly rule: string | null;
  readonly reason: string;
}

const GENESIS = '0'.repeat(64);

export class AuditLog {
  #paths: StorePaths;
  #seq = 0;
  #prev = GENESIS;
  /** Serialises appends; every write chains onto this promise. */
  #queue: Promise<void> = Promise.resolve();
  #ready = false;

  constructor(paths: StorePaths) {
    this.#paths = paths;
  }

  /** Read the tail of today's log to resume the sequence and hash chain. */
  async open(): Promise<void> {
    if (this.#ready) return;
    await fs.mkdir(this.#paths.audit, { recursive: true });
    const last = await this.#lastRecord();
    if (last) {
      this.#seq = last.seq;
      this.#prev = last.hash;
    }
    this.#ready = true;
  }

  async #lastRecord(): Promise<AuditRecord | null> {
    const file = this.#paths.auditFile(new Date());
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
    const lines = content.trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line) continue;
      try {
        return JSON.parse(line) as AuditRecord;
      } catch {
        // Truncated final line from a crash mid-append; step back one.
      }
    }
    return null;
  }

  append(
    type: AuditEventType,
    containerId: string | null,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    this.#queue = this.#queue.then(() => this.#write(type, containerId, data));
    return this.#queue;
  }

  async #write(
    type: AuditEventType,
    containerId: string | null,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.#ready) await this.open();

    const seq = ++this.#seq;
    const at = new Date().toISOString();
    const body = { seq, at, type, containerId, data, prev: this.#prev };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const record: AuditRecord = { ...body, hash };

    const file = this.#paths.auditFile(new Date());
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
    this.#prev = hash;
  }

  /** Flush pending appends. Call before exit so the last actions are durable. */
  async flush(): Promise<void> {
    await this.#queue;
  }

  /** Stream a day's records, newest last. */
  async *read(date = new Date()): AsyncGenerator<AuditRecord> {
    const file = this.#paths.auditFile(date);
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
          yield JSON.parse(line) as AuditRecord;
        } catch {
          // Skip a corrupt line rather than aborting the whole read — a partial
          // log is still evidence.
        }
      }
    } finally {
      lines.close();
      stream.close();
    }
  }

  /**
   * Walk the chain and report the first record whose hash does not follow from
   * its predecessor. `null` means the day's log is internally consistent.
   */
  async verify(date = new Date()): Promise<{ ok: boolean; brokenAt: number | null }> {
    let prev = GENESIS;
    for await (const record of this.read(date)) {
      const body = {
        seq: record.seq,
        at: record.at,
        type: record.type,
        containerId: record.containerId,
        data: record.data,
        prev,
      };
      const expected = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      if (expected !== record.hash) {
        return { ok: false, brokenAt: record.seq };
      }
      prev = record.hash;
    }
    return { ok: true, brokenAt: null };
  }
}
