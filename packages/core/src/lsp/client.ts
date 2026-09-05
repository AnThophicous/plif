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
import { safeRuntimeEnvironment } from '../security/runtime-environment.js';
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

/**
 * One project-wide symbol hit.
 *
 * Separate from SymbolInfo because a workspace search spans files: the file is
 * part of the answer rather than the question, and servers report the owning
 * class or module in containerName.
 */
/** One replacement inside one file, in the 1-based coordinates used everywhere here. */
export interface TextEdit {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly newText: string;
}

export interface DocumentEdit {
  readonly file: string;
  readonly edits: readonly TextEdit[];
}

/**
 * Everything a server wants changed in answer to one request.
 *
 * fileOperations counts the create, rename and delete entries a WorkspaceEdit
 * may also carry. They are counted rather than described because this client
 * does not perform them, and a caller that silently dropped them would apply
 * half of what the server asked for.
 */
/** One thing a server offers to do about a position, and whether it can be done here. */
export interface CodeAction {
  readonly title: string;
  readonly kind?: string;
  readonly change: WorkspaceChange | null;
  /** True when the action runs server-side rather than shipping its own edit. */
  readonly needsCommand: boolean;
}

/** One end of a call edge: who calls this, or what this calls. */
export interface CallSite {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface WorkspaceChange {
  readonly documents: readonly DocumentEdit[];
  readonly fileOperations: number;
}

export interface WorkspaceSymbolInfo {
  readonly name: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number;
  readonly container?: string;
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
const ANALYSIS_TIMEOUT_MS = 20_000;
const ANALYSIS_GRACE_MS = 3_000;
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
  #capabilities: Record<string, unknown> = {};
  #published = false;
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
      env: safeRuntimeEnvironment(),
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
      const handshake = await withTimeout(
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

      const capabilities = (handshake as { capabilities?: unknown } | null)?.capabilities;
      this.#capabilities = capabilities && typeof capabilities === 'object'
        ? (capabilities as Record<string, unknown>)
        : {};

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

    this.#published = true;
    this.#diagnostics.set(key, list);
    this.#diagnosticRevision.set(key, (this.#diagnosticRevision.get(key) ?? 0) + 1);
    for (const waiter of [...this.#waiters]) waiter(key);
  }

  /**
   * Whether the server advertised a capability during the handshake.
   *
   * A provider is either `true` or an options object, so presence is the whole
   * question. Asking beats probing: a server that never implemented
   * workspace/symbol answers an error, and waiting for it to answer otherwise
   * would be waiting for something that is never going to happen.
   */
  supports(capability: string): boolean {
    return Boolean(this.#capabilities[capability]);
  }

  /** Whether this server has ever published diagnostics, for anything. */
  get hasPublishedDiagnostics(): boolean {
    return this.#published;
  }

  /**
   * Wait until this server has said something about this particular file.
   *
   * Not "until the diagnostics settle" — one publication is enough, and it is the
   * signal that matters: a server cannot publish diagnostics for a file before it
   * has built the program that file belongs to. Every project-wide answer about
   * that file — every call site of a symbol in it, every edit a rename implies —
   * is only complete once that program exists.
   *
   * The ceiling is short for a server that has never published anything, because
   * a server that does not push diagnostics is never going to answer this and the
   * wait would be pure delay. It is generous for one that has, because then the
   * silence means a project is still loading.
   */
  async awaitAnalysis(file: string): Promise<boolean> {
    if (!this.#ready) return false;

    const absolute = path.resolve(file);
    const key = documentKey(absolute);
    await this.openFile(absolute);
    if ((this.#diagnosticRevision.get(key) ?? 0) > 0) return true;

    const budget = this.#published ? ANALYSIS_TIMEOUT_MS : ANALYSIS_GRACE_MS;
    return await this.#waitForDiagnosticRevision(key, 0, budget);
  }

  /** How many documents this server currently has open. */
  get openDocumentCount(): number {
    return this.#open.size;
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

  /**
   * Search the whole project for a declaration by name.
   *
   * Unlike every other request here this one is not about a file, so it opens
   * nothing: the server answers from the index it already built for the
   * workspace root. A server that does not implement the method replies with an
   * error, which reaches the caller as an empty result.
   */
  /** The signature of the call being written at this position, if there is one. */
  async signatureHelp(file: string, line: number, column: number): Promise<string | null> {
    const result = (await this.#request('textDocument/signatureHelp', file, line, column)) as {
      signatures?: { label?: string; documentation?: unknown }[];
      activeSignature?: number;
    } | null;

    const signatures = result?.signatures ?? [];
    const active = signatures[result?.activeSignature ?? 0] ?? signatures[0];
    if (!active?.label) return null;

    const documentation = active.documentation;
    const text = typeof documentation === 'string'
      ? documentation
      : ((documentation as { value?: string } | undefined)?.value ?? '');
    return text.trim() ? `${active.label}\n\n${text.trim()}` : active.label;
  }

  /**
   * What the server offers to do about this position.
   *
   * The cached diagnostics for the line go along with the request: a quick fix is
   * offered for a specific error, and a server asked without one has nothing to
   * fix. They are reconstructed from what this client kept, which is a start
   * position rather than the original span, so a server that matches on the exact
   * span may offer less here than an editor would.
   */
  async codeActions(file: string, line: number, column: number): Promise<CodeAction[]> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return [];

    await this.openFile(file);
    const position = { line: line - 1, character: column - 1 };
    const diagnostics = this.diagnosticsFor(file)
      .filter((item) => item.line === line)
      .map((item) => ({
        range: {
          start: { line: item.line - 1, character: item.column - 1 },
          end: { line: item.line - 1, character: item.column },
        },
        severity: item.severity === 'error' ? 1 : item.severity === 'warning' ? 2 : 3,
        message: item.message,
        ...(item.source ? { source: item.source } : {}),
        ...(item.code
          ? { code: Number.isNaN(Number(item.code)) ? item.code : Number(item.code) }
          : {}),
      }));

    const result = await withTimeout(
      connection.sendRequest('textDocument/codeAction', {
        textDocument: { uri: pathToFileURL(path.resolve(file)).toString() },
        range: { start: position, end: position },
        context: { diagnostics },
      }),
      REQUEST_TIMEOUT_MS,
      'codeAction',
    ).catch(() => null);

    return toCodeActions(result);
  }

  /** The edits that would put this file in the project's canonical shape. */
  async formatting(file: string): Promise<TextEdit[]> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return [];

    await this.openFile(file);
    const result = await withTimeout(
      connection.sendRequest('textDocument/formatting', {
        textDocument: { uri: pathToFileURL(path.resolve(file)).toString() },
        options: { tabSize: 2, insertSpaces: true },
      }),
      REQUEST_TIMEOUT_MS,
      'formatting',
    ).catch(() => null);

    return toTextEdits(result);
  }

  /**
   * Who calls this, or what this calls.
   *
   * Two round trips by design: the protocol makes you first resolve the position
   * to a hierarchy item, because a position is ambiguous and an item is not.
   */
  async calls(
    file: string,
    line: number,
    column: number,
    direction: 'incoming' | 'outgoing',
  ): Promise<CallSite[]> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return [];

    const prepared = await this.#request('textDocument/prepareCallHierarchy', file, line, column);
    const item = Array.isArray(prepared) ? prepared[0] : null;
    if (!item) return [];

    const result = await withTimeout(
      connection.sendRequest(`callHierarchy/${direction}Calls`, { item }),
      REQUEST_TIMEOUT_MS,
      'callHierarchy',
    ).catch(() => null);

    return toCallSites(result, direction === 'incoming' ? 'from' : 'to');
  }

  /** Where the interfaces or abstract members at this position are implemented. */
  async implementation(file: string, line: number, column: number): Promise<Location[]> {
    return toLocations(await this.#request('textDocument/implementation', file, line, column));
  }

  /** Where the type of the expression at this position is declared. */
  async typeDefinition(file: string, line: number, column: number): Promise<Location[]> {
    return toLocations(await this.#request('textDocument/typeDefinition', file, line, column));
  }

  /**
   * Ask what would have to change to call this symbol something else.
   *
   * Nothing is written here. The server answers with the edits it believes are
   * correct, and applying them is a separate decision made by a caller that can
   * see the write policy — which this client cannot.
   */
  async rename(
    file: string,
    line: number,
    column: number,
    newName: string,
  ): Promise<WorkspaceChange | null> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return null;

    await this.openFile(file);
    const result = await withTimeout(
      connection.sendRequest('textDocument/rename', {
        textDocument: { uri: pathToFileURL(path.resolve(file)).toString() },
        position: { line: line - 1, character: column - 1 },
        newName,
      }),
      REQUEST_TIMEOUT_MS,
      'rename',
    ).catch(() => null);

    return toWorkspaceChange(result);
  }

  async workspaceSymbols(query: string, limit = 200): Promise<WorkspaceSymbolInfo[]> {
    const connection = this.#connection;
    if (!connection || !this.#ready) return [];

    const result = await withTimeout(
      connection.sendRequest('workspace/symbol', { query }),
      REQUEST_TIMEOUT_MS,
      'workspaceSymbol',
    ).catch(() => null);

    return toWorkspaceSymbols(result, limit);
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

function toCodeActions(result: unknown): CodeAction[] {
  if (!Array.isArray(result)) return [];

  const out: CodeAction[] = [];
  for (const raw of result) {
    const item = raw as { title?: string; kind?: string; edit?: unknown; command?: unknown };
    if (!item.title) continue;
    out.push({
      title: item.title,
      ...(item.kind ? { kind: item.kind } : {}),
      change: item.edit ? toWorkspaceChange(item.edit) : null,
      needsCommand: Boolean(item.command) && !item.edit,
    });
  }
  return out;
}

function toCallSites(result: unknown, side: 'from' | 'to'): CallSite[] {
  if (!Array.isArray(result)) return [];

  const out: CallSite[] = [];
  for (const raw of result) {
    const edge = raw as Record<string, unknown>;
    const item = edge[side] as
      | { name?: string; uri?: string; selectionRange?: { start?: { line?: number } } }
      | undefined;
    const file = item?.uri ? safeFsPath(item.uri) : null;
    if (!file || !item?.name) continue;

    out.push({
      name: item.name,
      file,
      line: (item.selectionRange?.start?.line ?? 0) + 1,
    });
  }
  return out;
}

function toTextEdits(raw: unknown): TextEdit[] {
  if (!Array.isArray(raw)) return [];

  const out: TextEdit[] = [];
  for (const item of raw as {
    range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
    newText?: string;
  }[]) {
    if (!item.range?.start || !item.range.end) continue;
    out.push({
      startLine: (item.range.start.line ?? 0) + 1,
      startColumn: (item.range.start.character ?? 0) + 1,
      endLine: (item.range.end.line ?? 0) + 1,
      endColumn: (item.range.end.character ?? 0) + 1,
      newText: item.newText ?? '',
    });
  }
  return out;
}

/**
 * Normalize the two shapes a WorkspaceEdit is allowed to take.
 *
 * documentChanges is the newer, versioned form and wins when present; changes
 * is the flat map older servers still send. Both reduce to the same list here so
 * that no caller has to know which server it is talking to.
 */
function toWorkspaceChange(result: unknown): WorkspaceChange | null {
  if (!result || typeof result !== 'object') return null;

  const edit = result as {
    changes?: Record<string, unknown>;
    documentChanges?: unknown;
  };
  const documents: DocumentEdit[] = [];
  let fileOperations = 0;

  if (Array.isArray(edit.documentChanges)) {
    for (const raw of edit.documentChanges) {
      const change = raw as { kind?: string; textDocument?: { uri?: string }; edits?: unknown };
      if (change.kind) {
        // create, rename or delete: a file operation, not a text edit.
        fileOperations += 1;
        continue;
      }
      const file = change.textDocument?.uri ? safeFsPath(change.textDocument.uri) : null;
      if (!file) continue;
      const edits = toTextEdits(change.edits);
      if (edits.length > 0) documents.push({ file, edits });
    }
  } else if (edit.changes) {
    for (const [uri, raw] of Object.entries(edit.changes)) {
      const file = safeFsPath(uri);
      if (!file) continue;
      const edits = toTextEdits(raw);
      if (edits.length > 0) documents.push({ file, edits });
    }
  } else {
    return null;
  }

  return { documents, fileOperations };
}

function toWorkspaceSymbols(result: unknown, limit: number): WorkspaceSymbolInfo[] {
  if (!Array.isArray(result)) return [];

  const out: WorkspaceSymbolInfo[] = [];
  for (const raw of result) {
    if (out.length >= limit) break;
    const item = raw as {
      name?: string;
      kind?: number;
      containerName?: string;
      location?: { uri?: string; range?: { start?: { line?: number } } };
    };
    const uri = item.location?.uri;
    const file = uri ? safeFsPath(uri) : null;
    // A WorkspaceSymbol may carry only a uri until workspaceSymbol/resolve is
    // called; reporting the file without a line beats dropping the hit.
    if (!file || !item.name) continue;

    out.push({
      name: item.name,
      kind: SYMBOL_KINDS[item.kind ?? 0] ?? 'symbol',
      file,
      line: (item.location?.range?.start?.line ?? 0) + 1,
      ...(item.containerName ? { container: item.containerName } : {}),
    });
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
