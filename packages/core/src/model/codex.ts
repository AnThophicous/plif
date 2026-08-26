/**
 * OpenAI Codex provider.
 *
 * This adapter deliberately talks to the official local `codex app-server`
 * process instead of calling ChatGPT endpoints or reading Codex credentials.
 * The Codex CLI owns browser login, token refresh, account policy and the
 * app-server protocol; PLIF only speaks its documented JSON-RPC/JSONL boundary.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

import { PlifError } from '../errors.js';
import type { Effort, ModelConfig } from './config.js';
import type {
  CompletionEvent,
  CompletionRequest,
  ModelExecutionContext,
  ModelInfo,
  ModelListResult,
  ModelProvider,
  ProviderModel,
} from './provider.js';
import { NO_USAGE } from './provider.js';
import { repairCorruptCodexWindowsSandboxState } from './codex-sandbox-recovery.js';

const CODEX_COMMAND = 'codex';
const INITIALIZE_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 240;

type JsonRpcId = number;
type JsonRpcMessage = {
  readonly jsonrpc?: string;
  readonly id?: JsonRpcId;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
};

interface JsonRpcClientOptions {
  readonly command?: string;
  readonly requestTimeoutMs?: number;
  readonly onServerRequest?: (message: JsonRpcMessage) => Promise<unknown>;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

class CodexJsonRpcError extends Error {
  constructor(
    message: string,
    readonly rpcCode?: number,
  ) {
    super(message);
    this.name = 'CodexJsonRpcError';
  }
}

class CodexAbortError extends Error {
  constructor() {
    super('Codex turn cancelled');
    this.name = 'CodexAbortError';
  }
}

/** A small async queue that preserves notifications arriving before `turn/start` responds. */
class NotificationQueue {
  #items: JsonRpcMessage[] = [];
  #waiters: Array<{ resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void }> = [];
  #closed: Error | undefined;

  push(message: JsonRpcMessage): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve(message);
    else this.#items.push(message);
  }

  next(signal?: AbortSignal): Promise<JsonRpcMessage> {
    if (this.#items.length > 0) return Promise.resolve(this.#items.shift()!);
    if (this.#closed) return Promise.reject(this.#closed);
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      let waiter: { resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void };
      const onAbort = (): void => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new CodexAbortError());
      };
      if (signal?.aborted) {
        reject(new CodexAbortError());
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      waiter = {
        resolve: (message) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(message);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      this.#waiters.push(waiter);
    });
  }

  close(error = new Error('Codex app-server closed')): void {
    if (this.#closed) return;
    this.#closed = error;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
    this.#items.length = 0;
  }
}

class JsonRpcClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  readonly #listeners = new Set<(message: JsonRpcMessage) => void>();
  readonly #requestTimeoutMs: number;
  readonly #onServerRequest: ((message: JsonRpcMessage) => Promise<unknown>) | undefined;
  #nextId = 1;
  #closed = false;
  #closeError: Error | undefined;

  private constructor(child: ChildProcessWithoutNullStreams, options: JsonRpcClientOptions) {
    this.#child = child;
    this.#requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    this.#onServerRequest = options.onServerRequest;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.#onLine(line));
    child.on('error', (error) => this.#close(error));
    child.on('close', (code, signal) => {
      if (!this.#closed) {
        this.#close(new Error(`Codex app-server exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`));
      }
    });
    // stderr is intentionally drained but never copied into the PLIF
    // transcript. The Codex CLI can print configuration warnings there, and
    // forwarding those warnings would make a clean provider error look like a
    // second model response.
    child.stderr.resume();
  }

  static async start(options: JsonRpcClientOptions = {}): Promise<JsonRpcClient> {
    // The official Windows helper persists this state outside the repository.
    // Recover a torn state file before spawning the server so the first native
    // request does not fail with the misleading generic ACL error.
    repairCorruptCodexWindowsSandboxState();
    const command = options.command?.trim() || process.env['PLIF_CODEX_COMMAND']?.trim() || CODEX_COMMAND;
    let child: ChildProcessWithoutNullStreams;
    try {
      const commandArgs = ['app-server'];
      const executable = process.platform === 'win32' ? (process.env['ComSpec'] ?? 'cmd.exe') : command;
      const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', [quoteWindowsCommand(command), ...commandArgs].join(' ')]
        : commandArgs;
      child = spawn(executable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      throw new PlifError('MODEL_UNAVAILABLE', 'the Codex CLI could not be started', {
        cause: error,
        hint: 'Install the official Codex CLI, then select OpenAI Codex (ChatGPT) in PLIF to sign in.',
      });
    }

    const client = new JsonRpcClient(child, options);
    try {
      await client.request('initialize', {
        clientInfo: { name: 'plif', version: '0.3.9' },
        // PLIF sends runtimeWorkspaceRoots with thread/start and turn/start
        // so the official app-server can enforce the selected workspace
        // boundary. That field is part of Codex's experimental API surface;
        // advertising it here is required before either request is accepted.
        capabilities: { experimentalApi: true },
      }, INITIALIZE_TIMEOUT_MS);
      client.notify('initialized', {});
      return client;
    } catch (error) {
      client.close();
      throw translateCodexError(error, 'initializing the Codex app-server');
    }
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = this.#requestTimeoutMs): Promise<unknown> {
    if (this.#closed) return Promise.reject(this.#closeError ?? new Error('Codex app-server is closed'));
    const id = this.#nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new PlifError('MODEL_TIMEOUT', `Codex app-server timed out while handling ${method}`, {
          hint: 'Check that the Codex CLI is installed and that your ChatGPT login is still active.',
        }));
      }, Math.max(1_000, timeoutMs));
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#child.stdin.write(`${payload}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (this.#closed) return;
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  onNotification(listener: (message: JsonRpcMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    if (this.#closed) return;
    this.#close(new Error('Codex app-server closed by PLIF'));
    try { this.#child.kill(); } catch { /* already exited */ }
  }

  #onLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      // The app-server contract is JSONL. Ignore non-JSON diagnostics rather
      // than letting a malformed line break an otherwise valid turn.
      return;
    }

    if (typeof message.id === 'number' && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new CodexJsonRpcError(
          message.error.message ?? 'Codex app-server request failed',
          message.error.code,
        ));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.id === 'number' && message.method) {
      if (this.#onServerRequest) {
        void this.#onServerRequest(message)
          .then((result) => this.#writeServerResponse(message.id!, { result }))
          .catch((error: unknown) => this.#writeServerResponse(message.id!, {
            error: { code: -32000, message: truncateError(error instanceof Error ? error.message : String(error)) },
          }));
      } else {
        this.#writeServerResponse(message.id, {
          error: { code: -32601, message: 'PLIF did not provide an app-server request handler' },
        });
      }
      return;
    }

    if (message.method) for (const listener of this.#listeners) listener(message);
  }

  #close(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeError = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#listeners) listener({ method: 'codex/closed', params: {} });
  }

  #writeServerResponse(id: JsonRpcId, response: { result?: unknown; error?: Record<string, unknown> }): void {
    if (this.#closed) return;
    try {
      this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...response })}\n`);
    } catch { /* the process is already shutting down */ }
  }
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function truncateError(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > MAX_ERROR_LENGTH ? `${compact.slice(0, MAX_ERROR_LENGTH - 1)}…` : compact;
}

function quoteWindowsCommand(command: string): string {
  // `cmd /c` is used only to execute the installed .cmd shim on Windows. The
  // command itself comes from controlled configuration, never from a model or
  // transcript. Quote only paths that need it and reject embedded quotes so a
  // malformed override cannot turn into an extra command.
  if (command.includes('"')) return 'codex';
  return /[\s&|<>^]/.test(command) ? `"${command}"` : command;
}

function translateCodexError(error: unknown, operation: string): PlifError {
  if (PlifError.is(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('not found') || lower.includes('enoent') || lower.includes('could not be started')) {
    return new PlifError('MODEL_UNAVAILABLE', 'the official Codex CLI is not available', {
      cause: error,
      hint: 'Install the official Codex CLI, then select OpenAI Codex (ChatGPT) in PLIF to sign in.',
    });
  }
  if (lower.includes('login') || lower.includes('log in') || lower.includes('sign in') ||
    lower.includes('authenticate') || lower.includes('authenticated') || lower.includes('not logged') ||
    lower.includes('unauthorized') || lower.includes('account')) {
    return new PlifError('MODEL_AUTH', 'the Codex provider is not signed in to ChatGPT', {
      cause: error,
      hint: 'Select OpenAI Codex (ChatGPT) in PLIF to sign in, then retry the request.',
    });
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return new PlifError('MODEL_TIMEOUT', `Codex timed out while ${operation}`, {
      cause: error,
      hint: 'Check the Codex CLI session and network connection, then retry.',
    });
  }
  return new PlifError('MODEL_ERROR', `Codex failed while ${operation}: ${truncateError(message)}`, {
    cause: error,
    hint: 'Select OpenAI Codex (ChatGPT) in PLIF to verify the ChatGPT session, then retry.',
  });
}

function modelEfforts(raw: Record<string, unknown>): string[] {
  return arrayValue(raw['supportedReasoningEfforts'])
    .map((item) => recordValue(item)?.['reasoningEffort'])
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function codexModel(raw: Record<string, unknown>): ProviderModel | undefined {
  const id = textValue(raw['model']) ?? textValue(raw['id']);
  if (!id || raw['hidden'] === true) return undefined;
  const modalities = arrayValue(raw['inputModalities'])
    .filter((value): value is 'text' | 'image' => value === 'text' || value === 'image');
  const efforts = modelEfforts(raw);
  const displayName = textValue(raw['displayName']);
  return {
    id,
    ...(displayName ? { name: displayName } : {}),
    ...(modalities.length > 0 ? { modalities } : { modalities: ['text', 'image'] }),
    reasoning: efforts.length > 0,
    tools: true,
    cost: 'unknown',
    provider: 'codex',
    product: 'OpenAI',
    tier: 'Codex / ChatGPT',
    protocol: 'openai-chat',
    metadataSource: 'provider',
  };
}

function supportedEffortsFromModel(raw: Record<string, unknown>): string[] {
  return modelEfforts(raw);
}

function modelListData(result: unknown): readonly Record<string, unknown>[] {
  const root = recordValue(result);
  return arrayValue(root?.['data']).map(recordValue).filter((item): item is Record<string, unknown> => item !== undefined);
}

function workspaceRoots(execution: ModelExecutionContext | undefined): readonly string[] {
  const candidates = [execution?.cwd, ...(execution?.workspaceRoots ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => (isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value)));
  return [...new Set(candidates)];
}

function pathIsInsideRoots(candidate: string, roots: readonly string[]): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalized = resolve(candidate);
  return roots.some((root) => {
    const child = relative(root, normalized);
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
  });
}

export function codexPermissionSettings(execution: ModelExecutionContext | undefined): {
  readonly roots: readonly string[];
  readonly thread: Record<string, unknown>;
  readonly turn: Record<string, unknown>;
} {
  const roots = workspaceRoots(execution);
  // A missing root is intentionally fail-closed. `auto-approve` never turns
  // into write access to whichever directory happened to launch PLIF.
  const mode = roots.length > 0 ? execution?.permissionMode ?? 'deny' : 'deny';
  const writable = mode !== 'deny';
  const approvalPolicy = mode === 'ask' ? 'on-request' : 'never';
  return {
    roots,
    thread: {
      approvalPolicy,
      sandbox: writable ? 'workspace-write' : 'read-only',
      ...(roots.length > 0 ? { runtimeWorkspaceRoots: roots } : {}),
    },
    turn: {
      approvalPolicy,
      sandboxPolicy: writable
        ? { type: 'workspaceWrite', writableRoots: roots }
        : { type: 'readOnly' },
      ...(roots.length > 0 ? { runtimeWorkspaceRoots: roots } : {}),
    },
  };
}

function safePermissionProfile(
  requested: Record<string, unknown>,
  roots: readonly string[],
): Record<string, unknown> {
  const fileSystem = recordValue(requested['fileSystem']);
  const network = recordValue(requested['network']);
  const safeFileSystem: Record<string, unknown> = {};
  if (fileSystem) {
    const read = arrayValue(fileSystem['read']).filter(
      (value): value is string => typeof value === 'string' && pathIsInsideRoots(value, roots),
    );
    const write = arrayValue(fileSystem['write']).filter(
      (value): value is string => typeof value === 'string' && pathIsInsideRoots(value, roots),
    );
    if (read.length > 0) safeFileSystem['read'] = read;
    if (write.length > 0) safeFileSystem['write'] = write;
    const entries = arrayValue(fileSystem['entries'])
      .map(recordValue)
      .filter((entry): entry is Record<string, unknown> => entry !== undefined)
      .filter((entry) => {
        const path = recordValue(entry['path']);
        return path?.['type'] === 'path' &&
          typeof path['path'] === 'string' &&
          pathIsInsideRoots(path['path'], roots);
      });
    if (entries.length > 0) safeFileSystem['entries'] = entries;
    if (typeof fileSystem['globScanMaxDepth'] === 'number') {
      safeFileSystem['globScanMaxDepth'] = fileSystem['globScanMaxDepth'];
    }
  }
  const safe: Record<string, unknown> = {};
  if (Object.keys(safeFileSystem).length > 0) safe['fileSystem'] = safeFileSystem;
  // Network access is still routed through the same PLIF approval decision;
  // it is not implied by filesystem write access.
  if (network?.['enabled'] === true) safe['network'] = { enabled: true };
  return safe;
}

function approvalDecisionResponse(decision: 'allow' | 'deny' | 'cancel'): Record<string, unknown> {
  return { decision: decision === 'allow' ? 'accept' : decision === 'cancel' ? 'cancel' : 'decline' };
}

async function handleCodexServerRequest(
  message: JsonRpcMessage,
  execution: ModelExecutionContext | undefined,
  roots: readonly string[],
): Promise<unknown> {
  const method = message.method;
  const params = message.params ?? {};
  if (!method) throw new Error('Codex app-server request has no method');

  if (method === 'item/tool/requestUserInput') {
    const answers: Record<string, { answers: string[] }> = {};
    for (const [index, rawQuestion] of arrayValue(params['questions']).entries()) {
      const question = recordValue(rawQuestion);
      if (!question) continue;
      const id = textValue(question['id']) ?? `question-${index + 1}`;
      const answer = execution?.ask
        ? await execution.ask({
            text: textValue(question['question']) ?? textValue(question['header']) ?? 'Choose an option.',
            options: arrayValue(question['options'])
              .map(recordValue)
              .filter((option): option is Record<string, unknown> => option !== undefined)
              .map((option) => ({
                value: textValue(option['label']) ?? '',
                label: textValue(option['label']) ?? 'Option',
                ...(textValue(option['description']) ? { description: textValue(option['description']) } : {}),
              }))
              .filter((option) => option.value.length > 0),
            context: textValue(question['header'])
              ? `Codex is asking: ${textValue(question['header'])}`
              : 'Choose an option in the PLIF input.',
            ...(question['isSecret'] === true ? { secret: true } : {}),
          })
        : null;
      answers[id] = { answers: answer === null ? [] : [answer] };
    }
    return { answers };
  }

  const approve = execution?.approve;
  if (method === 'item/commandExecution/requestApproval') {
    const decision = approve
      ? await approve({
          kind: 'execute',
          target: textValue(params['command']) ?? textValue(params['cwd']) ?? 'Codex command',
          argv: arrayValue(params['commandActions']).filter((value): value is string => typeof value === 'string'),
          reason: textValue(params['reason']) ?? 'Codex requested command execution.',
        })
      : 'deny';
    return approvalDecisionResponse(decision);
  }
  if (method === 'item/fileChange/requestApproval') {
    const decision = approve
      ? await approve({
          kind: 'write',
          target: textValue(params['grantRoot']) ?? textValue(params['itemId']) ?? 'Codex file change',
          reason: textValue(params['reason']) ?? 'Codex requested a file change.',
        })
      : 'deny';
    return approvalDecisionResponse(decision);
  }
  if (method === 'item/permissions/requestApproval') {
    const requested = recordValue(params['permissions']) ?? {};
    const decision = approve
      ? await approve({
          kind: 'permissions',
          target: 'Codex additional permissions',
          reason: textValue(params['reason']) ?? 'Codex requested additional permissions.',
          network: recordValue(requested['network'])?.['enabled'] === true,
        })
      : 'deny';
    return {
      permissions: decision === 'allow' ? safePermissionProfile(requested, roots) : {},
      scope: 'turn',
    };
  }
  throw new Error(`Unsupported Codex app-server request: ${method}`);
}

function codexPrompt(request: CompletionRequest): { text: string; images: string[]; developer?: string } {
  const preloadedSkills = request.preloadedSkills ?? [];
  const developer = [
    ...request.messages
      .filter((message) => message.role === 'system' && message.content)
      .map((message) => message.content),
    ...(preloadedSkills.length > 0
      ? [
          'PLIF SKILL BRIDGE: this is a native Codex turn. Host-defined PLIF tools are not part of the native Codex tool schema, so do not call the `skill` tool for the preloaded skills below. Treat these skill bodies as already loaded and follow them for this turn.',
          ...preloadedSkills.map((skill) => `# Skill: ${skill.name}\n\n${skill.instructions}`),
        ]
      : []),
    'When a material decision from the human is required, use the inline PLIF question UI (or your native request_user_input tool) instead of asking a clarification question in prose. Keep the same turn open and continue after the answer.',
  ].join('\n\n');
  const text = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const attachmentText = (message.attachments ?? [])
        .filter((attachment): attachment is Extract<NonNullable<typeof message.attachments>[number], { kind: 'text' }> => attachment.kind === 'text')
        .map((attachment) => `\n[${attachment.name}]\n${attachment.text}`)
        .join('');
      const reasoning = message.reasoning ? `\n[reasoning]\n${message.reasoning}` : '';
      return `${message.role.toUpperCase()}:\n${message.content}${attachmentText}${reasoning}`;
    })
    .join('\n\n');
  const images = request.messages.flatMap((message) => (message.attachments ?? [])
    .filter((attachment): attachment is Extract<NonNullable<typeof message.attachments>[number], { kind: 'image' }> => attachment.kind === 'image')
    .map((attachment) => `data:${attachment.mediaType};base64,${attachment.data}`));
  return { text: text || 'Please respond to the user.', images, ...(developer ? { developer } : {}) };
}

const EFFORT_ORDER: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function wireEffort(effort: Effort | undefined, supported: readonly string[]): string | undefined {
  if (!effort) return undefined;
  const requested = effort === 'plif' || effort === 'ultracode' ? 'ultra' : effort;
  if (supported.length === 0 || supported.includes(requested)) return requested;
  const requestedIndex = Math.max(0, EFFORT_ORDER.indexOf(requested));
  const candidates = supported
    .filter((value) => EFFORT_ORDER.includes(value))
    .sort((a, b) => EFFORT_ORDER.indexOf(b) - EFFORT_ORDER.indexOf(a));
  return candidates.find((value) => EFFORT_ORDER.indexOf(value) <= requestedIndex)
    ?? candidates.at(-1)
    ?? requested;
}

function matchesTurn(message: JsonRpcMessage, threadId: string, turnId: string): boolean {
  const params = message.params;
  if (!params) return false;
  const messageThread = textValue(params['threadId']);
  const messageTurn = textValue(params['turnId']);
  return (messageThread === undefined || messageThread === threadId) &&
    (messageTurn === undefined || messageTurn === turnId);
}

export interface CodexProviderOptions {
  /** Test-only command override; production uses `codex` from PATH. */
  readonly command?: string;
}

export interface CodexLoginResult {
  readonly ok: boolean;
  readonly cancelled?: boolean;
  readonly detail?: string;
}

/**
 * Login state owned by the official Codex app-server.
 *
 * PLIF never receives or stores ChatGPT tokens. The app-server returns the
 * official OAuth URL, PLIF opens it, and completion arrives as a JSON-RPC
 * notification. Keeping this handle explicit also gives the TUI a real Esc
 * cancellation path instead of abandoning a child process mid-login.
 */
export interface CodexLoginFlow {
  readonly alreadyAuthenticated: boolean;
  readonly authUrl?: string;
  readonly verificationUrl?: string;
  readonly userCode?: string;
  readonly wait: () => Promise<CodexLoginResult>;
  readonly cancel: () => Promise<void>;
}

export async function startCodexLogin(options: CodexProviderOptions = {}): Promise<CodexLoginFlow> {
  let client: JsonRpcClient | undefined;
  try {
    client = await JsonRpcClient.start(options);
    const accountResponse = recordValue(await client.request('account/read', {}));
    const account = recordValue(accountResponse?.['account']);
    if (account?.['type'] === 'chatgpt') {
      client.close();
      return {
        alreadyAuthenticated: true,
        wait: async () => ({ ok: true, detail: 'ChatGPT account already connected' }),
        cancel: async () => undefined,
      };
    }

    const login = recordValue(await client.request('account/login/start', {
      type: 'chatgpt',
      appBrand: 'codex',
      useHostedLoginSuccessPage: true,
    }));
    const loginId = textValue(login?.['loginId']);
    if (!loginId) throw new Error('Codex did not return a login id');
    const authUrl = textValue(login?.['authUrl']);
    const verificationUrl = textValue(login?.['verificationUrl']);
    const userCode = textValue(login?.['userCode']);
    if (!authUrl && !verificationUrl) throw new Error('Codex did not return a sign-in URL');

    let settled = false;
    let resolveResult!: (result: CodexLoginResult) => void;
    const result = new Promise<CodexLoginResult>((resolve) => { resolveResult = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      finish({ ok: false, detail: 'ChatGPT sign-in timed out' });
    }, LOGIN_TIMEOUT_MS);
    timer.unref?.();
    const unsubscribe = client.onNotification((message) => {
      if (message.method !== 'account/login/completed') return;
      const params = message.params ?? {};
      const eventLoginId = params['loginId'];
      if (eventLoginId !== null && eventLoginId !== undefined && eventLoginId !== loginId) return;
      const error = textValue(params['error']);
      finish({
        ok: params['success'] === true,
        ...(error ? { detail: error } : {}),
      });
    });

    function finish(value: CodexLoginResult): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      unsubscribe();
      client?.close();
      resolveResult(value);
    }

    return {
      alreadyAuthenticated: false,
      ...(authUrl ? { authUrl } : {}),
      ...(verificationUrl ? { verificationUrl } : {}),
      ...(userCode ? { userCode } : {}),
      wait: () => result,
      cancel: async () => {
        if (settled) return;
        try {
          await client?.request('account/login/cancel', { loginId }, 5_000);
        } catch {
          // Cancellation remains successful from the UI perspective even if
          // the browser flow already completed or the child exited.
        }
        finish({ ok: false, cancelled: true, detail: 'ChatGPT sign-in cancelled' });
      },
    };
  } catch (error) {
    client?.close();
    throw translateCodexError(error, 'starting ChatGPT sign-in');
  }
}

export class CodexProvider implements ModelProvider {
  readonly info: ModelInfo;
  readonly #config: ModelConfig;
  readonly #options: CodexProviderOptions;
  #effortMap: Map<string, string[]> | undefined;
  #effortLoad: Promise<void> | undefined;

  constructor(config: ModelConfig, options: CodexProviderOptions = {}) {
    this.#config = config;
    this.#options = options;
    this.info = {
      id: config.model,
      providerId: 'codex',
      endpoint: 'codex://app-server',
      contextWindow: config.contextWindow,
      ...(config.maxTokens === undefined ? {} : { maxOutputTokens: config.maxTokens }),
      capabilities: {
        usageSemantics: 'unknown',
        cacheSupport: 'unknown',
        cacheAccounting: 'unknown',
        reasoningAccounting: 'unknown',
      },
    };
  }

  async listModels(): Promise<ModelListResult> {
    let client: JsonRpcClient | undefined;
    try {
      client = await JsonRpcClient.start(this.#options);
      const result = await client.request('model/list', {});
      const rawModels = modelListData(result);
      const models = rawModels.map(codexModel).filter((model): model is ProviderModel => model !== undefined);
      this.#effortMap = new Map(rawModels.map((raw) => {
        const id = textValue(raw['model']) ?? textValue(raw['id']);
        return id ? [id, supportedEffortsFromModel(raw)] as const : undefined;
      }).filter((entry): entry is readonly [string, string[]] => entry !== undefined));
      return {
        supported: true,
        models,
        source: { provider: 'codex', product: 'OpenAI', tier: 'Codex / ChatGPT', endpoint: 'codex://app-server' },
      };
    } catch (error) {
      const translated = translateCodexError(error, 'listing ChatGPT models');
      return {
        supported: false,
        models: [],
        error: translated.code === 'MODEL_AUTH' ? 'unauthorized' : translated.code === 'MODEL_TIMEOUT' ? 'unavailable' : 'unavailable',
      };
    } finally {
      client?.close();
    }
  }

  async list(): Promise<string[]> {
    const result = await this.listModels();
    return result.models.map((model) => model.id);
  }

  async probe(): Promise<{ ok: boolean; detail: string }> {
    const result = await this.listModels();
    if (result.supported && result.models.length > 0) {
      return { ok: true, detail: `ChatGPT account available through Codex · ${result.models.length} model(s)` };
    }
    if (result.error === 'unauthorized') {
      return { ok: false, detail: 'Codex is not signed in to ChatGPT · select the provider in PLIF' };
    }
    return { ok: false, detail: 'Codex app-server is unavailable · install Codex CLI' };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionEvent> {
    if (request.signal?.aborted) {
      yield { kind: 'done', reason: 'cancelled', usage: NO_USAGE };
      return;
    }

    await this.#loadEfforts();
    let client: JsonRpcClient | undefined;
    let queue: NotificationQueue | undefined;
    let unsubscribe: (() => void) | undefined;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let abortHandler: (() => void) | undefined;

    try {
      const permissionSettings = codexPermissionSettings(request.execution);
      client = await JsonRpcClient.start({
        ...this.#options,
        requestTimeoutMs: this.#config.timeoutMs,
        onServerRequest: (message) => handleCodexServerRequest(message, request.execution, permissionSettings.roots),
      });
      const prompt = codexPrompt(request);
      const threadParams: Record<string, unknown> = {
        cwd: request.execution?.cwd ?? process.cwd(),
        ephemeral: true,
        serviceName: 'plif',
        threadSource: 'plif',
        ...permissionSettings.thread,
        ...(prompt.developer ? { developerInstructions: prompt.developer } : {}),
        ...(!isDefaultCodexModel(this.#config.model) ? { model: this.#config.model } : {}),
      };
      const thread = recordValue(await client.request('thread/start', threadParams));
      threadId = textValue(thread?.['thread'] && recordValue(thread['thread'])?.['id'])
        ?? textValue(thread?.['id']);
      if (!threadId) throw new Error('Codex did not return a thread id');

      queue = new NotificationQueue();
      unsubscribe = client.onNotification((message) => queue!.push(message));
      abortHandler = (): void => {
        queue?.close(new CodexAbortError());
        if (threadId && turnId) {
          void client?.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
        }
      };
      request.signal?.addEventListener('abort', abortHandler, { once: true });

      const effort = wireEffort(this.#config.effort, this.#effortMap?.get(this.#config.model) ?? []);
      const input: Array<Record<string, string>> = [{ type: 'text', text: prompt.text }];
      for (const image of prompt.images) input.push({ type: 'image', url: image });
      const turn = recordValue(await client.request('turn/start', {
        threadId,
        input,
        ...permissionSettings.turn,
        ...(effort ? { effort } : {}),
        ...(!isDefaultCodexModel(this.#config.model) ? { model: this.#config.model } : {}),
      }));
      turnId = textValue(turn?.['turn'] && recordValue(turn['turn'])?.['id']) ?? textValue(turn?.['id']);
      if (!turnId) throw new Error('Codex did not return a turn id');

      while (true) {
        const message = await queue.next(request.signal);
        if (!matchesTurn(message, threadId, turnId)) continue;
        const method = message.method;
        const params = message.params ?? {};
        const delta = textValue(params['delta']);
        if (delta && method === 'item/agentMessage/delta') {
          yield { kind: 'text', delta };
          continue;
        }
        if (delta && (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta')) {
          yield { kind: 'reasoning', delta };
          continue;
        }
        if (method === 'error') {
          throw translateCodexError(new Error(textValue(params['message']) ?? 'Codex turn failed'), 'running the turn');
        }
        if (method !== 'turn/completed') continue;
        const turn = recordValue(params['turn']);
        const status = textValue(turn?.['status']) ?? textValue(params['status']);
        if (status === 'interrupted') {
          yield { kind: 'done', reason: 'cancelled', usage: NO_USAGE };
          return;
        }
        if (status === 'failed') {
          const error = recordValue(turn?.['error']) ?? recordValue(params['error']);
          throw translateCodexError(new Error(textValue(error?.['message']) ?? 'Codex turn failed'), 'running the turn');
        }
        yield { kind: 'done', reason: 'stop', usage: NO_USAGE };
        return;
      }
    } catch (error) {
      if (error instanceof CodexAbortError || request.signal?.aborted) {
        yield { kind: 'done', reason: 'cancelled', usage: NO_USAGE };
        return;
      }
      throw translateCodexError(error, 'running the turn');
    } finally {
      if (abortHandler) request.signal?.removeEventListener('abort', abortHandler);
      unsubscribe?.();
      queue?.close();
      client?.close();
    }
  }

  withEffort(effort: Effort): ModelProvider {
    return new CodexProvider({ ...this.#config, effort }, this.#options);
  }

  async #loadEfforts(): Promise<void> {
    if (this.#effortMap || this.#effortLoad) return this.#effortLoad ?? Promise.resolve();
    this.#effortLoad = this.listModels().then(() => undefined).catch(() => undefined);
    await this.#effortLoad;
  }
}

function isDefaultCodexModel(model: string): boolean {
  return model === '' || model === 'codex-default' || model === 'default' || model === 'auto';
}
