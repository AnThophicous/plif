import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/node';
import type { MessageConnection } from 'vscode-jsonrpc/node';

import { PlifError } from '../errors.js';
import { languageIdFor } from './servers.js';
import type { ResolvedServer } from './servers.js';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: Severity;
  readonly message: string;
  readonly source?: string;
  readonly code?: string;
}

export interface Location {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface SymbolInfo {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly detail?: string;
}

const SEVERITY: Readonly<Record<number, Severity>> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

const SYMBOL_KINDS: Readonly<Record<number, string>> = {
  1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method',
  7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface',
  12: 'function', 13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
  17: 'boolean', 18: 'array', 19: 'object', 20: 'key', 21: 'null',
  22: 'enum member', 23: 'struct', 24: 'event', 25: 'operator', 26: 'type parameter',
};

const INITIALIZE_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
const DIAGNOSTIC_SETTLE_MS = 1_500;
const DIAGNOSTIC_QUIET_MS = 300;

interface OpenDocument {
  readonly file: string;
  readonly text: string;
  readonly version: number;
}

export class LspClient {
  readonly id: string;
  readonly label: string;
  readonly root: string;

  #resolved: ResolvedServer;
  #child: ChildProcessWithoutNullStreams | null = null;
  #connection: MessageConnection | null = null;
  #diagnostics = new Map<string, Diagnostic[]>();
  #diagnosticRevision = new Map<string, number>();
  #open = new Map<string, OpenDocument>();
  #waiters = new Set<(file: string) => void>();
  #ready = false;
  #detail = 'not started';
  #stderr = '';
  #serverLog = '';
  #stopping = false;

  constructor(resolved: ResolvedServer, root: string) {
    this.#resolved = resolved;
    this.id = resolved.spec.id;
    this.label = resolved.spec.label;
    this.root = path.resolve(root);
  }

  get ready(): boolean {
    return this.#ready;
  }

  get detail(): string {
    return this.#detail;
  }

  get logTail(): string {
    return this.#serverLog;
  }

  async start(): Promise<void> {
    if (this.#ready) return;
    this.#stopping = false;
    this.#stderr = '';
    this.#serverLog = '';
    const child = spawn(this.#resolved.command, [...this.#resolved.args], {
      cwd: this.root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.#resolved.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    }) as ChildProcessWithoutNullStreams;

    child.on('error', (error) => {
      this.#detail = error.message;
      this.#ready = false;
      for (const waiter of [...this.#waiters]) waiter('');
    });
    child.on('close', (code, signal) => {
      this.#ready = false;
      if (!this.#stopping) {
        const exit = `process exited${code === null ? ` by ${signal ?? 'signal'}` : ` with code ${code}`}`;
        this.#detail = this.#stderr ? `${exit}: ${lastLine(this.#stderr)}` : exit;
      }
      if (this.#child === child) {
        this.#child = null;
        this.#connection = null;
      }
      for (const waiter of [...this.#waiters]) waiter('');
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-4_096);
    });

    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );

    connection.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
      this.#absorb(params as { uri: string; version?: unknown; diagnostics: unknown[] });
    });
    connection.onRequest('workspace/configuration', (params: unknown) => {
      const items = (params as { items?: unknown[] } | null)?.items;
      return Array.isArray(items)
        ? items.map((item) => {
            const section = (item as { section?: unknown } | null)?.section;
            return section === 'formattingOptions' ? { tabSize: 2, insertSpaces: true } : {};
          })
        : [];
    });
    connection.onRequest('workspace/workspaceFolders', () => [
      { uri: pathToFileURL(this.root).toString(), name: path.basename(this.root) },
    ]);
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.onNotification('window/logMessage', (params: unknown) => {
      const message = (params as { message?: unknown } | null)?.message;
      if (typeof message === 'string' && message.trim()) {
        this.#serverLog = (this.#serverLog + message.trim() + '\n').slice(-8_192);
      }
    });
    connection.onNotification('$/progress', () => undefined);

    connection.listen();
    this.#child = child;
    this.#connection = connection;

    try {
      await withTimeout(
        connection.sendRequest('initialize', {
          processId: process.pid,
          rootUri: pathToFileURL(this.root).toString(),
          workspaceFolders: [
            { uri: pathToFileURL(this.root).toString(), name: path.basename(this.root) },
          ],
          capabilities: {
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: true },
              publishDiagnostics: { relatedInformation: false },
              hover: { contentFormat: ['plaintext', 'markdown'] },
              definition: { linkSupport: false },
              references: {},
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            },
            workspace: { workspaceFolders: true, configuration: true },
          },
          ...(this.#resolved.spec.initializationOptions
            ? { initializationOptions: this.#resolved.spec.initializationOptions }
            : {}),
        }),
        INITIALIZE_TIMEOUT_MS,
        'initialize',
      );

      connection.sendNotification('initialized', {});
      this.#ready = true;
      this.#detail = `${this.#resolved.source}: ${this.#resolved.command}`;
    } catch (error) {
      await this.stop();
      throw new PlifError('LSP_UNAVAILABLE', `${this.label} language server failed to start`, {
        cause: error,
        detail: { command: this.#resolved.command },
        hint: `Try: ${this.#resolved.spec.install}`,
      });
    }
  }

  #absorb(params: { uri: string; version?: unknown; diagnostics: unknown[] }): void {
    const file = safeFsPath(params.uri);
    if (!file) return;
    const key = documentKey(file);
    const document = this.#open.get(key);
    const version = typeof params.version === 'number' && Number.isInteger(params.version)
      ? params.version
      : null;
    if (version !== null && (!document || version !== document.version)) return;

    const list: Diagnostic[] = [];
    for (const raw of params.diagnostics ?? []) {
      const item = raw as {
        range?: { start?: { line?: number; character?: number } };
        severity?: number;
        message?: string;
        source?: string;
        code?: string | number;
      };
      list.push({
        file,
        line: (item.range?.start?.line ?? 0) + 1,
        column: (item.range?.start?.character ?? 0) + 1,
        severity: SEVERITY[item.severity ?? 1] ?? 'error',
        message: item.message ?? '',
        ...(item.source ? { source: item.source } : {}),
        ...(item.code !== undefined ? { code: String(item.code) } : {}),
      });
    }

    this.#diagnostics.set(key, list);
    this.#diagnosticRevision.set(key, (this.#diagnosticRevision.get(key) ?? 0) + 1);
    for (const waiter of [...this.#waiters]) waiter(key);
  }

  async openFile(file: string): Promise<boolean> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return false;

    const absolute = path.resolve(file);
    const key = documentKey(absolute);
    const previous = this.#open.get(key);
    const text = await fs.readFile(absolute, 'utf8').catch(() => null);
    if (text === null) {
      if (previous) {
        connection.sendNotification('textDocument/didClose', {
          textDocument: { uri: pathToFileURL(previous.file).toString() },
        });
        this.#open.delete(key);
        this.#diagnostics.delete(key);
        this.#diagnosticRevision.delete(key);
      }
      return false;
    }
    if (previous?.text === text) return false;

    const version = (previous?.version ?? 0) + 1;
    this.#open.set(key, { file: absolute, text, version });
    this.#diagnostics.delete(key);

    if (!previous) {
      connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: pathToFileURL(absolute).toString(),
          languageId: languageIdFor(absolute) ?? 'plaintext',
          version,
          text,
        },
      });
    } else {
      connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: pathToFileURL(absolute).toString(), version },
        contentChanges: [{ text }],
      });
    }
    return true;
  }

  /**
   * Open a file and wait for the server to say something about it.
   *
   * Servers publish diagnostics asynchronously and give no signal that they are
   * finished, so this settles on a short timer rather than pretending there is
   * a completion event. An empty result after the wait means "nothing reported
   * yet", not "no problems" — which is why the caller is told the difference.
   */
  async diagnose(file: string, settleMs = DIAGNOSTIC_SETTLE_MS): Promise<Diagnostic[]> {
    const absolute = path.resolve(file);
    const key = documentKey(absolute);
    if (!this.#ready) return [];

    let revision = this.#diagnosticRevision.get(key) ?? 0;
    const changed = await this.openFile(absolute);
    if (!this.#ready) return [];
    if (!changed && this.#diagnostics.has(key)) return [...(this.#diagnostics.get(key) ?? [])];

    const deadline = Date.now() + Math.max(0, settleMs);
    while (this.#ready && Date.now() < deadline) {
      const arrived = await this.#waitForDiagnosticRevision(key, revision, deadline - Date.now());
      if (!arrived) break;
      revision = this.#diagnosticRevision.get(key) ?? revision;
      const quiet = await this.#waitForDiagnosticRevision(
        key,
        revision,
        Math.min(DIAGNOSTIC_QUIET_MS, Math.max(0, deadline - Date.now())),
      );
      if (!quiet) {
        // Several servers acknowledge a change with [] before their slower
        // semantic pass publishes the real errors. A non-empty list may settle
        // after the quiet window; an empty list must wait through the deadline
        // or it recreates the false-clean race this method exists to prevent.
        if ((this.#diagnostics.get(key)?.length ?? 0) > 0) break;
        continue;
      }
      revision = this.#diagnosticRevision.get(key) ?? revision;
    }
    return [...(this.#diagnostics.get(key) ?? [])];
  }

  async #waitForDiagnosticRevision(key: string, after: number, timeoutMs: number): Promise<boolean> {
    if ((this.#diagnosticRevision.get(key) ?? 0) > after) return true;
    if (timeoutMs <= 0 || !this.#ready) return false;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#waiters.delete(waiter);
        resolve(value);
      };
      const waiter = (changed: string): void => {
        if (changed === '') finish(false);
        else if (changed === key && (this.#diagnosticRevision.get(key) ?? 0) > after) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      this.#waiters.add(waiter);
    });
  }

  diagnosticsFor(file: string): Diagnostic[] {
    return [...(this.#diagnostics.get(documentKey(file)) ?? [])];
  }

  allDiagnostics(): Diagnostic[] {
    return [...this.#diagnostics.values()].flat();
  }

  async definition(file: string, line: number, column: number): Promise<Location[]> {
    const result = await this.#request('textDocument/definition', file, line, column);
    return toLocations(result);
  }

  async references(file: string, line: number, column: number): Promise<Location[]> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return [];

    await this.openFile(file);
    const result = await withTimeout(
      connection.sendRequest('textDocument/references', {
        textDocument: { uri: pathToFileURL(path.resolve(file)).toString() },
        position: { line: line - 1, character: column - 1 },
        context: { includeDeclaration: false },
      }),
      REQUEST_TIMEOUT_MS,
      'references',
    ).catch(() => null);

    return toLocations(result);
  }

  async hover(file: string, line: number, column: number): Promise<string | null> {
    const result = (await this.#request('textDocument/hover', file, line, column)) as {
      contents?: unknown;
    } | null;
    if (!result?.contents) return null;

    const contents = result.contents;
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) {
      return contents
        .map((part) => (typeof part === 'string' ? part : ((part as { value?: string }).value ?? '')))
        .join('\n')
        .trim();
    }
    return ((contents as { value?: string }).value ?? '').trim() || null;
  }

  async symbols(file: string): Promise<SymbolInfo[]> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return [];

    await this.openFile(file);
    const result = await withTimeout(
      connection.sendRequest('textDocument/documentSymbol', {
        textDocument: { uri: pathToFileURL(path.resolve(file)).toString() },
      }),
      REQUEST_TIMEOUT_MS,
      'documentSymbol',
    ).catch(() => null);

    return flattenSymbols(result);
  }

  async #request(
    method: string,
    file: string,
    line: number,
    column: number,
  ): Promise<unknown> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return null;

    await this.openFile(file);
    return await withTimeout(
      connection.sendRequest(method, {
        textDocument: { uri: pathToFileURL(path.resolve(file)).toString() },
        position: { line: line - 1, character: column - 1 },
      }),
      REQUEST_TIMEOUT_MS,
      method,
    ).catch(() => null);
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#ready = false;
    const connection = this.#connection;
    const child = this.#child;

    if (connection) {
      await withTimeout(connection.sendRequest('shutdown', null), 3_000, 'shutdown').catch(
        () => undefined,
      );
      try {
        connection.sendNotification('exit');
      } catch {
        // already gone
      }
      connection.dispose();
    }
    if (child) {
      const exited = await waitForChildExit(child, 500);
      if (!exited && child.exitCode === null && child.signalCode === null) child.kill();
      await waitForChildExit(child, 1_000);
    }
    this.#connection = null;
    this.#child = null;
    this.#open.clear();
    this.#detail = 'stopped';
    for (const waiter of [...this.#waiters]) waiter('');
  }
}

function toLocations(result: unknown): Location[] {
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];

  const out: Location[] = [];
  for (const raw of list) {
    const item = raw as {
      uri?: string;
      targetUri?: string;
      range?: { start?: { line?: number; character?: number } };
      targetSelectionRange?: { start?: { line?: number; character?: number } };
    };
    const uri = item.uri ?? item.targetUri;
    const range = item.range ?? item.targetSelectionRange;
    const file = uri ? safeFsPath(uri) : null;
    if (!file) continue;

    out.push({
      file,
      line: (range?.start?.line ?? 0) + 1,
      column: (range?.start?.character ?? 0) + 1,
    });
  }
  return out;
}

function flattenSymbols(result: unknown, depth = 0): SymbolInfo[] {
  if (!Array.isArray(result) || depth > 3) return [];

  const out: SymbolInfo[] = [];
  for (const raw of result) {
    const item = raw as {
      name?: string;
      kind?: number;
      detail?: string;
      range?: { start?: { line?: number } };
      location?: { range?: { start?: { line?: number } } };
      children?: unknown;
    };
    const line = (item.range?.start?.line ?? item.location?.range?.start?.line ?? 0) + 1;

    out.push({
      name: item.name ?? '(unnamed)',
      kind: SYMBOL_KINDS[item.kind ?? 0] ?? 'symbol',
      line,
      ...(item.detail ? { detail: item.detail } : {}),
    });
    out.push(...flattenSymbols(item.children, depth + 1));
  }
  return out;
}

function safeFsPath(uri: string): string | null {
  try {
    return path.resolve(fileURLToPath(uri));
  } catch {
    return null;
  }
}

function documentKey(file: string): string {
  const absolute = path.resolve(file);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function lastLine(value: string): string {
  return value.trim().split(/\r?\n/).at(-1)?.trim() ?? '';
}

async function waitForChildExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('close', onClose);
      resolve(value);
    };
    const onClose = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once('close', onClose);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
