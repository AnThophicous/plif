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

export class LspClient {
  readonly id: string;
  readonly label: string;
  readonly root: string;

  #resolved: ResolvedServer;
  #child: ChildProcessWithoutNullStreams | null = null;
  #connection: MessageConnection | null = null;
  #diagnostics = new Map<string, Diagnostic[]>();
  #open = new Map<string, number>();
  #waiters = new Set<(file: string) => void>();
  #ready = false;
  #detail = 'not started';

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

  async start(): Promise<void> {
    const child = spawn(this.#resolved.command, [...this.#resolved.args], {
      cwd: this.root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    child.on('error', (error) => {
      this.#detail = error.message;
      this.#ready = false;
    });
    child.on('close', (code, signal) => {
      this.#ready = false;
      this.#detail = `process exited${code === null ? ` by ${signal ?? 'signal'}` : ` with code ${code}`}`;
      for (const waiter of [...this.#waiters]) waiter('');
    });
    child.stderr.resume();

    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );

    connection.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
      this.#absorb(params as { uri: string; diagnostics: unknown[] });
    });
    connection.onRequest('workspace/configuration', () => [{}]);
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.onNotification('window/logMessage', () => undefined);
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

  #absorb(params: { uri: string; diagnostics: unknown[] }): void {
    const file = safeFsPath(params.uri);
    if (!file) return;

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

    this.#diagnostics.set(file, list);
    for (const waiter of [...this.#waiters]) waiter(file);
  }

  async openFile(file: string): Promise<void> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return;

    const absolute = path.resolve(file);
    const text = await fs.readFile(absolute, 'utf8').catch(() => null);
    if (text === null) return;

    const version = (this.#open.get(absolute) ?? 0) + 1;
    this.#open.set(absolute, version);

    if (version === 1) {
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
    if (!this.#ready) return [];

    let resolveWait: (() => void) | null = null;
    const arrived = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });
    const waiter = (changed: string): void => {
      if (changed === absolute) resolveWait?.();
    };
    this.#waiters.add(waiter);

    try {
      await this.openFile(absolute);
      await Promise.race([arrived, delay(settleMs)]);
      // A second beat: many servers publish an empty list first and the real
      // findings a moment later, so returning on the first notification would
      // report a clean file that is not.
      await delay(200);
      return this.#diagnostics.get(absolute) ?? [];
    } finally {
      this.#waiters.delete(waiter);
    }
  }

  diagnosticsFor(file: string): Diagnostic[] {
    return this.#diagnostics.get(path.resolve(file)) ?? [];
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
    this.#ready = false;
    const connection = this.#connection;
    const child = this.#child;
    this.#connection = null;
    this.#child = null;

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
    if (child && !child.killed) child.kill();
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}
