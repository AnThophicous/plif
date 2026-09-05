import path from 'node:path';

import type { EventBus } from '../events/bus.js';
import { LspClient } from './client.js';
import type { Diagnostic, WorkspaceSymbolInfo } from './client.js';
import { SERVERS, detectLanguages, findFileWithExtension, resolveServer, serverFor } from './servers.js';
import type { ResolvedServer, ServerSpec } from './servers.js';

/**
 * How long to let a freshly primed server finish loading its project.
 *
 * Measured on this repository against the bundled TypeScript server, with the
 * servers already warm: the first document opens, and the same query answers
 * nothing for 3.4 seconds and then four hits. Retrying inside that window is the
 * difference between "the index was not ready yet" and the answer "this symbol
 * does not exist" — and the second one is a lie the caller cannot detect.
 *
 * The ceiling is generous because it is only ever reached by a query with no
 * answer, on the one call per server that opens its first document. A query that
 * does match returns the moment the index has it.
 */
/** How long a server that failed to start is left alone before trying again. */
const START_RETRY_COOLDOWN_MS = 5 * 60_000;

const INDEX_SETTLE_MS = 250;
const INDEX_SETTLE_ATTEMPTS = 40;

export interface LspStatus {
  readonly id: string;
  readonly label: string;
  readonly ready: boolean;
  readonly detail: string;
  readonly diagnostics: number;
}

export interface LspManagerOptions {
  readonly root: string;
  /** Managed scratch root for server metadata; avoids loose OS-temp files. */
  readonly tempRoot?: string;
  readonly bus?: EventBus;
  readonly enabled?: boolean;
  readonly resolveServer?: (spec: ServerSpec, root: string, tempRoot?: string) => Promise<ResolvedServer | null>;
  readonly createClient?: (resolved: ResolvedServer, root: string) => LspClient;
}

export class LspManager {
  readonly root: string;

  #bus: EventBus | undefined;
  #enabled: boolean;
  #clients = new Map<string, LspClient>();
  #starting = new Map<string, Promise<LspClient | null>>();
  #missing = new Map<string, ServerSpec>();
  /**
   * When each server last failed to start.
   *
   * Without this every call that wants a language server retried a broken one:
   * a fresh spawn, a wait as long as the initialize timeout, and the same
   * warning again, on every tool call for the rest of the session. A cooldown
   * rather than a permanent mark, because the usual reason is a toolchain that
   * is being installed while the session runs.
   */
  #failedAt = new Map<string, number>();
  #resolveServer: (spec: ServerSpec, root: string, tempRoot?: string) => Promise<ResolvedServer | null>;
  #createClient: (resolved: ResolvedServer, root: string) => LspClient;
  #stopping = false;
  #tempRoot: string | undefined;
  #primed = new Map<string, string>();

  constructor(options: LspManagerOptions) {
    this.root = path.resolve(options.root);
    this.#tempRoot = options.tempRoot ? path.resolve(options.tempRoot) : undefined;
    this.#bus = options.bus;
    this.#enabled = options.enabled !== false;
    this.#resolveServer = options.resolveServer ?? resolveServer;
    this.#createClient = options.createClient ?? ((resolved, root) => new LspClient(resolved, root));
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
      const resolved = await this.#resolveServer(spec, this.root, this.#tempRoot);
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
    await Promise.allSettled(survey.available.map((spec) => this.#ensureStarted(spec)));
  }

  async clientFor(file: string): Promise<LspClient | null> {
    if (!this.#enabled) return null;

    const spec = serverFor(file);
    if (!spec) return null;

    return await this.#ensureStarted(spec);
  }

  async #ensureStarted(spec: ServerSpec): Promise<LspClient | null> {
    if (this.#stopping) return null;
    const inFlight = this.#starting.get(spec.id);
    if (inFlight) return await inFlight;

    const existing = this.#clients.get(spec.id);
    if (existing?.ready) return existing;

    const failed = this.#failedAt.get(spec.id);
    if (failed !== undefined && Date.now() - failed < START_RETRY_COOLDOWN_MS) return null;

    const attempt = this.#restart(spec, existing);
    this.#starting.set(spec.id, attempt);
    try {
      return await attempt;
    } finally {
      if (this.#starting.get(spec.id) === attempt) this.#starting.delete(spec.id);
    }
  }

  async #restart(spec: ServerSpec, existing: LspClient | undefined): Promise<LspClient | null> {
    if (existing) {
      this.#clients.delete(spec.id);
      await existing.stop();
    }
    return await this.#start(spec);
  }

  async #start(spec: ServerSpec): Promise<LspClient | null> {
    const resolved = await this.#resolveServer(spec, this.root, this.#tempRoot);
    if (!resolved) {
      this.#missing.set(spec.id, spec);
      this.#bus?.emit('log', {
        level: 'debug',
        message: `no ${spec.label} language server on this machine`,
        detail: { install: spec.install },
      });
      return null;
    }

    const client = this.#createClient(resolved, this.root);
    try {
      await client.start();
      if (this.#stopping) {
        await client.stop();
        return null;
      }
      this.#clients.set(spec.id, client);
      this.#missing.delete(spec.id);
      this.#failedAt.delete(spec.id);
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
      this.#failedAt.set(spec.id, Date.now());
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

  /**
   * Find a declaration anywhere in the workspace, by name.
   *
   * The search is not tied to a file, so it asks every running server and
   * merges the answers: a polyglot repository can hold the same name in two
   * languages, and both are real hits. Servers normally started during warmup;
   * when none have, this pays that cost once rather than reporting nothing.
   *
   * Returns null when the workspace has no server at all, which is a different
   * answer from an empty array — the same distinction diagnose() makes, and for
   * the same reason: "nothing looked" must not read as "nothing exists".
   */
  async searchSymbols(query: string, limit = 100): Promise<WorkspaceSymbolInfo[] | null> {
    if (!this.#enabled) return null;
    if (this.#clients.size === 0) await this.warmup();
    if (this.#clients.size === 0) return null;

    const answers = await Promise.all(
      [...this.#clients].map(async ([id, client]) => {
        const primed = await this.#primeIndex(id, client);
        let hits = await client.workspaceSymbols(query, limit).catch(() => []);

        // Retry the question actually asked, not a cheaper stand-in. A server
        // will answer a generic probe out of the one file it has open while the
        // project is still loading, so a probe reports ready too early; only the
        // real query distinguishes "not indexed yet" from "not there".
        for (
          let attempt = 0;
          primed && hits.length === 0 && attempt < INDEX_SETTLE_ATTEMPTS;
          attempt += 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, INDEX_SETTLE_MS));
          hits = await client.workspaceSymbols(query, limit).catch(() => []);
        }
        return hits;
      }),
    );

    // Two servers can index the same file, and one server can report a symbol
    // once per declaration site. Collapse on the identity the caller sees.
    const seen = new Set<string>();
    const merged: WorkspaceSymbolInfo[] = [];
    for (const hit of answers.flat()) {
      const key = `${hit.file}:${hit.line}:${hit.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(hit);
      if (merged.length >= limit) break;
    }
    return merged;
  }

  /**
   * Give a server one open document before asking it about the workspace.
   *
   * tsserver answers workspace/symbol out of the project it has loaded, and it
   * loads no project until a document is opened. Cold, the search returns an
   * empty list that reads exactly like "no such symbol" — the one failure this
   * tool must not have. Measured on this repository: 0 hits with nothing open,
   * 2 with a single file open. One file is the whole difference, so pay for it
   * here instead of expecting the caller to know. Returns whether this call was
   * the one that opened it, which is what tells the caller to wait for the index.
   */
  async #primeIndex(id: string, client: LspClient): Promise<boolean> {
    if (client.openDocumentCount > 0) return false;

    const cached = this.#primed.get(id);
    if (cached) {
      await client.openFile(cached);
      return true;
    }

    const spec = SERVERS.find((candidate) => candidate.id === id);
    if (!spec) return false;
    const sample = await findFileWithExtension(this.root, spec.extensions, 4);
    if (!sample) return false;

    this.#primed.set(id, sample);
    await client.openFile(sample);
    return true;
  }

  /**
   * Start the server for a file and wait until it has analysed that file.
   *
   * A server that has not read a file answers questions about it with silence,
   * and silence is indistinguishable from "there is nothing there". Measured
   * against the bundled TypeScript server on this repository: a rename requested
   * the moment the file opened rewrote the declaration and none of its importers,
   * and reported success.
   *
   * This is necessary and not sufficient. Diagnostics arrive once the program
   * containing the file is built, which is before the server has indexed the
   * files that import it — measured here, three seconds before. A caller that
   * needs the call sites has to wait for the call sites; see rename_symbol.
   *
   * The wait is per file, not per server, and that is what a monorepo needs:
   * opening some other package's file loads that package's project, which says
   * nothing about the one being edited.
   */
  async ensureIndexed(file: string): Promise<LspClient | null> {
    const client = await this.clientFor(file);
    if (!client) return null;

    await client.awaitAnalysis(file);
    return client;
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
    this.#stopping = true;
    await Promise.allSettled([...this.#starting.values()]);
    const clients = [...new Set(this.#clients.values())];
    this.#clients.clear();
    this.#starting.clear();
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
