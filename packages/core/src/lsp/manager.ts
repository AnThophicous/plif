import path from 'node:path';

import type { EventBus } from '../events/bus.js';
import { LspClient } from './client.js';
import type { Diagnostic } from './client.js';
import { detectLanguages, resolveServer, serverFor } from './servers.js';
import type { ServerSpec } from './servers.js';

export interface LspStatus {
  readonly id: string;
  readonly label: string;
  readonly ready: boolean;
  readonly detail: string;
  readonly diagnostics: number;
}

export interface LspManagerOptions {
  readonly root: string;
  readonly bus?: EventBus;
  readonly enabled?: boolean;
}

export class LspManager {
  readonly root: string;

  #bus: EventBus | undefined;
  #enabled: boolean;
  #clients = new Map<string, LspClient>();
  #starting = new Map<string, Promise<LspClient | null>>();
  #missing = new Map<string, ServerSpec>();

  constructor(options: LspManagerOptions) {
    this.root = path.resolve(options.root);
    this.#bus = options.bus;
    this.#enabled = options.enabled !== false;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /**
   * Look at the workspace and report which servers apply and which are missing.
   *
   * Nothing is spawned here. Starting a language server costs seconds and a few
   * hundred megabytes, and most sessions never touch a file that needs one, so
   * they start on first use instead.
   */
  async survey(): Promise<{ available: ServerSpec[]; missing: ServerSpec[] }> {
    const detected = await detectLanguages(this.root);
    const available: ServerSpec[] = [];
    const missing: ServerSpec[] = [];

    for (const spec of detected) {
      const resolved = await resolveServer(spec, this.root);
      if (resolved) available.push(spec);
      else {
        missing.push(spec);
        this.#missing.set(spec.id, spec);
      }
    }
    return { available, missing };
  }

  async warmup(): Promise<void> {
    if (!this.#enabled) return;
    const survey = await this.survey();
    await Promise.allSettled(survey.available.map((spec) => this.#start(spec)));
  }

  async clientFor(file: string): Promise<LspClient | null> {
    if (!this.#enabled) return null;

    const spec = serverFor(file);
    if (!spec) return null;

    const existing = this.#clients.get(spec.id);
    if (existing) return existing.ready ? existing : null;

    const inFlight = this.#starting.get(spec.id);
    if (inFlight) return await inFlight;

    const attempt = this.#start(spec);
    this.#starting.set(spec.id, attempt);
    try {
      return await attempt;
    } finally {
      this.#starting.delete(spec.id);
    }
  }

  async #start(spec: ServerSpec): Promise<LspClient | null> {
    const resolved = await resolveServer(spec, this.root);
    if (!resolved) {
      this.#missing.set(spec.id, spec);
      this.#bus?.emit('log', {
        level: 'debug',
        message: `no ${spec.label} language server on this machine`,
        detail: { install: spec.install },
      });
      return null;
    }

    const client = new LspClient(resolved, this.root);
    try {
      await client.start();
      this.#clients.set(spec.id, client);
      this.#bus?.emit('lsp.ready', {
        server: spec.id,
        label: spec.label,
        root: this.root,
      });
      return client;
    } catch (error) {
      this.#bus?.emit('log', {
        level: 'warn',
        message: `${spec.label} language server did not start`,
        detail: { reason: error instanceof Error ? error.message : String(error) },
      });
      return null;
    }
  }

  /**
   * Diagnostics for a file the agent just touched.
   *
   * Returns null when there is no server for this language at all, which is a
   * different answer from an empty array. "No server" must not be reported to
   * the agent as "no problems" — that would let it believe a file type-checks
   * when nothing ever looked at it.
   */
  async diagnose(file: string): Promise<Diagnostic[] | null> {
    const client = await this.clientFor(file);
    if (!client) return null;
    return await client.diagnose(file);
  }

  async statuses(): Promise<LspStatus[]> {
    const out: LspStatus[] = [];

    for (const [id, client] of this.#clients) {
      out.push({
        id,
        label: client.label,
        ready: client.ready,
        detail: client.detail,
        diagnostics: client.allDiagnostics().length,
      });
    }
    for (const [id, spec] of this.#missing) {
      if (this.#clients.has(id)) continue;
      out.push({
        id,
        label: spec.label,
        ready: false,
        detail: `not installed — ${spec.install}`,
        diagnostics: 0,
      });
    }
    return out;
  }

  clients(): LspClient[] {
    return [...this.#clients.values()];
  }

  async stop(): Promise<void> {
    const clients = [...this.#clients.values()];
    this.#clients.clear();
    await Promise.allSettled(clients.map((client) => client.stop()));
  }
}

export function formatDiagnostics(
  diagnostics: readonly Diagnostic[],
  root: string,
  limit = 20,
): string {
  if (diagnostics.length === 0) return '';

  const order: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };
  const sorted = [...diagnostics].sort(
    (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.line - b.line,
  );

  const shown = sorted.slice(0, limit);
  const lines = shown.map((item) => {
    const where = `${path.relative(root, item.file).replace(/\\/g, '/')}:${item.line}:${item.column}`;
    const code = item.code ? ` [${item.code}]` : '';
    return `${item.severity} ${where}${code} — ${item.message.split('\n')[0]}`;
  });

  if (sorted.length > shown.length) {
    lines.push(`… and ${sorted.length - shown.length} more`);
  }
  return lines.join('\n');
}

export function countBySeverity(
  diagnostics: readonly Diagnostic[],
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const item of diagnostics) {
    if (item.severity === 'error') errors += 1;
    else if (item.severity === 'warning') warnings += 1;
  }
  return { errors, warnings };
}
