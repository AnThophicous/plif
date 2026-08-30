/**
 * Session-scoped environment variables.
 *
 * This module deliberately has two different surfaces:
 *
 *   - `loadForExecution()` is an internal execution surface. It is the only
 *     method that returns values, and callers must keep those values in memory
 *     only long enough to construct a child process environment.
 *   - `status()`/`names()` are safe UI surfaces. They never return values.
 *
 * A session environment is not a global `.env` file. Its storage key binds the
 * absolute workspace and the session id, and the same binding is also stored
 * inside the encrypted record. The filename is a digest, so neither the
 * workspace nor variable names are disclosed by a directory listing.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PlifError } from '../errors.js';
import {
  canUseSystemdCreds,
  runSystemdCreds,
  runWindowsDpapi,
  type DpapiRunner,
  type SystemdCredsRunner,
} from './store.js';

export type EnvironmentMap = Readonly<Record<string, string>>;

export type SessionEnvironmentBackend =
  | 'windows-dpapi'
  | 'linux-systemd-creds'
  | 'memory';

export interface SessionEnvironmentScope {
  readonly workspace: string;
  readonly sessionId: string;
}

/**
 * Deliberately safe to hand to a UI. It contains names and capability state,
 * never the environment map itself or an error/cause from a crypto command.
 */
export interface SessionEnvironmentStatus {
  readonly scope: SessionEnvironmentScope;
  readonly backend: SessionEnvironmentBackend;
  readonly persistent: boolean;
  readonly secureBackendAvailable: boolean;
  readonly names: readonly string[];
  readonly warning?: string;
}

export interface SessionEnvironmentStoreOptions {
  /** Directory under which encrypted session records are kept. */
  readonly root?: string;
  /** `auto` selects DPAPI on Windows, systemd-creds when available on Linux. */
  readonly backend?: 'auto' | SessionEnvironmentBackend;
  /** Injectable runners make the crypto boundary testable without an OS secret store. */
  readonly dpapi?: DpapiRunner;
  readonly systemdCreds?: SystemdCredsRunner;
}

export type EnvironmentNameSelection =
  | readonly string[]
  | Readonly<Record<string, unknown>>;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_ENV_NAME_LENGTH = 128;
const MAX_ENV_VALUE_LENGTH = 128 * 1024;
const MAX_ENV_VARIABLES = 512;
const MAX_ENV_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MEMORY_ONLY_WARNING =
  'Secure session-environment persistence is unavailable; values are memory-only for this process.';

/** The durable root for encrypted environments, separate from transcripts. */
export function personalSessionEnvironmentPath(home = os.homedir()): string {
  return path.join(home, '.plif', 'session-env');
}

/**
 * Validate one environment name without ever echoing a value. The same guard
 * is used by the `.env` parser, persistence layer and running container.
 */
export function validateEnvironmentName(name: string): string {
  if (typeof name !== 'string' || name.length > MAX_ENV_NAME_LENGTH || !ENVIRONMENT_NAME.test(name)) {
    throw new PlifError('INVALID_ARGUMENT', 'environment variable name is invalid');
  }
  return name;
}

/**
 * Copy and validate an environment map. Values are intentionally not trimmed:
 * whitespace can be meaningful in tokens and certificates. NUL is rejected
 * because Node cannot safely pass it to a child process.
 */
export function normalizeEnvironmentMap(values: Readonly<Record<string, string>>): Record<string, string> {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new PlifError('INVALID_ARGUMENT', 'environment map is invalid');
  }

  const normalized: Record<string, string> = {};
  const entries = Object.entries(values);
  if (entries.length > MAX_ENV_VARIABLES) {
    throw new PlifError('INVALID_ARGUMENT', 'too many session environment variables', {
      hint: `Keep session environments below ${MAX_ENV_VARIABLES} keys.`,
    });
  }
  for (const [name, value] of entries) {
    validateEnvironmentName(name);
    if (typeof value !== 'string' || value.length > MAX_ENV_VALUE_LENGTH || value.includes('\0')) {
      throw new PlifError('INVALID_ARGUMENT', 'environment variable value is invalid');
    }
    // `__proto__` is a legal-looking environment name but is special on a
    // normal object. Define an own data property so normalization cannot
    // silently change the prototype or drop that key.
    Object.defineProperty(normalized, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return normalized;
}

/** Validate a set of names without inspecting or returning associated values. */
export function normalizeEnvironmentNames(selection: EnvironmentNameSelection): string[] {
  if (selection === null || typeof selection !== 'object') {
    throw new PlifError('INVALID_ARGUMENT', 'environment variable names are invalid');
  }
  const names = Array.isArray(selection) ? [...selection] : Object.keys(selection);
  return [...new Set(names.map((name) => validateEnvironmentName(name)))];
}

function invalidDotEnvLine(line: number): PlifError {
  // Do not include the source line: it may contain the value the user pasted.
  return new PlifError('INVALID_ARGUMENT', `invalid .env entry at line ${line}`, {
    detail: { line },
  });
}

function parseDotEnvValue(raw: string, line: number): string {
  const value = raw.trim();
  if (value.startsWith("'")) {
    const match = value.match(/^'([^']*)'(?:\s+#.*)?$/);
    if (!match) throw invalidDotEnvLine(line);
    const parsed = match[1] ?? '';
    if (parsed.includes('\0')) throw invalidDotEnvLine(line);
    return parsed;
  }

  if (value.startsWith('"')) {
    // JSON string syntax gives us deterministic escaping for double-quoted
    // dotenv values, including newlines represented as "\\n".
    const match = value.match(/^("(?:\\.|[^"\\])*")(?:\s+#.*)?$/);
    if (!match) throw invalidDotEnvLine(line);
    try {
      const parsed: unknown = JSON.parse(match[1] as string);
      if (typeof parsed !== 'string' || parsed.includes('\0')) throw new Error('invalid value');
      return parsed;
    } catch {
      throw invalidDotEnvLine(line);
    }
  }

  // An inline comment starts only after whitespace, so URLs and fragments such
  // as `https://host/#anchor` remain intact.
  const comment = value.search(/\s+#/);
  const unquoted = comment === -1 ? value : value.slice(0, comment).trimEnd();
  if (unquoted.includes('\0')) throw invalidDotEnvLine(line);
  return unquoted;
}

/** Parse a dotenv document without putting any parsed value in an exception. */
export function parseDotEnv(source: string): Record<string, string> {
  if (
    typeof source !== 'string' ||
    source.includes('\0') ||
    Buffer.byteLength(source, 'utf8') > MAX_ENV_DOCUMENT_BYTES
  ) {
    throw new PlifError('INVALID_ARGUMENT', 'the .env document is invalid');
  }

  const values: Record<string, string> = {};
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const assignment = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!assignment) throw invalidDotEnvLine(lineNumber);

    const name = validateEnvironmentName(assignment[1] as string);
    const parsed = parseDotEnvValue(assignment[2] ?? '', lineNumber);
    if (parsed.length > MAX_ENV_VALUE_LENGTH) throw invalidDotEnvLine(lineNumber);
    Object.defineProperty(values, name, {
      configurable: true,
      enumerable: true,
      value: parsed,
      writable: true,
    });
    if (Object.keys(values).length > MAX_ENV_VARIABLES) throw invalidDotEnvLine(lineNumber);
  }
  return values;
}

/**
 * Produce deterministic dotenv text. Every value is quoted, so a round trip
 * cannot turn a token containing `#`, spaces or newlines into a comment.
 */
export function serializeDotEnv(values: EnvironmentMap): string {
  const normalized = normalizeEnvironmentMap(values);
  const lines = Object.keys(normalized)
    .sort()
    .map((name) => `${name}=${JSON.stringify(normalized[name])}`);
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function normalizedScope(scope: SessionEnvironmentScope): SessionEnvironmentScope {
  if (scope === null || typeof scope !== 'object') {
    throw new PlifError('INVALID_ARGUMENT', 'session environment scope is invalid');
  }
  if (typeof scope.workspace !== 'string' || scope.workspace.includes('\0')) {
    throw new PlifError('INVALID_ARGUMENT', 'session workspace is invalid');
  }
  if (typeof scope.sessionId !== 'string' || !SESSION_ID.test(scope.sessionId)) {
    throw new PlifError('INVALID_ARGUMENT', 'session id is invalid');
  }
  return { workspace: path.resolve(scope.workspace), sessionId: scope.sessionId };
}

function workspaceDigest(workspace: string): string {
  let normalized = path.resolve(workspace);
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function scopeDigest(scope: SessionEnvironmentScope): string {
  const workspace = process.platform === 'win32' ? scope.workspace.toLowerCase() : scope.workspace;
  return createHash('sha256').update(`${workspace}\0${scope.sessionId}`).digest('hex');
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function scopeLockKey(root: string, scope: SessionEnvironmentScope): string {
  return `${path.resolve(root)}\0${scopeDigest(scope)}`;
}

/**
 * A process-wide tail per scope. Keeping this outside the class means two
 * stores opened by two different callers cannot race on the same record.
 */
const ENVIRONMENT_LOCKS = new Map<string, Promise<void>>();
const FILE_LOCK_TIMEOUT_MS = 30_000;
const FILE_LOCK_STALE_MS = 120_000;
const FILE_LOCK_RETRY_MS = 25;

function enqueueEnvironmentOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = ENVIRONMENT_LOCKS.get(key) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  ENVIRONMENT_LOCKS.set(key, tail);
  void tail.then(() => {
    if (ENVIRONMENT_LOCKS.get(key) === tail) ENVIRONMENT_LOCKS.delete(key);
  });
  return run;
}

function lockDirectory(root: string, scope: SessionEnvironmentScope): string {
  return path.join(root, '.locks', `${scopeDigest(scope)}.lock`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Serialize read-modify-write operations across separate Plif processes too.
 * Atomic rename prevents a torn ciphertext, while this short-lived directory
 * lock prevents two terminals from both reading the same old environment and
 * losing one another's update. A crashed process leaves only a digest-named
 * lock directory; after a conservative lease it can be reclaimed.
 */
async function withFileLock<T>(
  root: string,
  scope: SessionEnvironmentScope,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = lockDirectory(root, scope);
  await fs.mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  const started = Date.now();
  let acquired = false;
  while (!acquired) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const stat = await fs.stat(lock);
        stale = Date.now() - stat.mtimeMs > FILE_LOCK_STALE_MS;
      } catch (statError) {
        if (isMissing(statError)) continue;
      }
      if (stale) {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - started >= FILE_LOCK_TIMEOUT_MS) {
        throw new PlifError('INTERNAL', 'session environment is busy', {
          hint: 'Another Plif process is updating this session environment; retry shortly.',
        });
      }
      await delay(FILE_LOCK_RETRY_MS);
    }
  }

  try {
    return await operation();
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface StoredEnvironmentRecord {
  readonly version: 1;
  readonly workspace: string;
  readonly sessionId: string;
  readonly values: EnvironmentMap;
}

function storedRecord(scope: SessionEnvironmentScope, values: EnvironmentMap): StoredEnvironmentRecord {
  return {
    version: 1,
    workspace: scope.workspace,
    sessionId: scope.sessionId,
    values: normalizeEnvironmentMap(values),
  };
}

function parseStoredRecord(encoded: string, expected: SessionEnvironmentScope): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('invalid encrypted session environment');
  }
  if (value === null || typeof value !== 'object') throw new Error('invalid encrypted session environment');
  const record = value as Partial<StoredEnvironmentRecord>;
  if (
    record.version !== 1 ||
    record.workspace !== expected.workspace ||
    record.sessionId !== expected.sessionId ||
    record.values === null ||
    typeof record.values !== 'object' ||
    Array.isArray(record.values)
  ) {
    throw new Error('session environment binding mismatch');
  }
  return normalizeEnvironmentMap(record.values as Readonly<Record<string, string>>);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function cloneEnvironment(values: EnvironmentMap): Record<string, string> {
  return { ...values };
}

type PersistentEnvironmentBackend = Exclude<SessionEnvironmentBackend, 'memory'>;

const PERSISTENT_ENVIRONMENT_BACKENDS: readonly PersistentEnvironmentBackend[] = [
  'windows-dpapi',
  'linux-systemd-creds',
];

const PERSISTENT_RECORD_UNAVAILABLE_WARNING =
  'The existing encrypted session environment could not be opened; it remains untouched. Clear it explicitly or restore the secure backend before changing it.';

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    // A permission error is treated as "possibly present". Failing closed here
    // prevents a write from being reported as memory-only while a durable record
    // may still exist behind an inaccessible path.
    return !isMissing(error);
  }
}

export class SessionEnvironmentStore {
  readonly #root: string;
  readonly #dpapi: DpapiRunner;
  readonly #systemdCreds: SystemdCredsRunner;
  readonly #memory = new Map<string, Record<string, string>>();
  readonly #blockedPersistentKeys = new Set<string>();
  readonly #persistentBackend: PersistentEnvironmentBackend | undefined;
  #backend: SessionEnvironmentBackend;
  #warning: string | undefined;

  constructor(options: SessionEnvironmentStoreOptions = {}) {
    this.#root = path.resolve(options.root ?? personalSessionEnvironmentPath());
    this.#dpapi = options.dpapi ?? runWindowsDpapi;
    this.#systemdCreds = options.systemdCreds ?? runSystemdCreds;
    this.#backend = selectBackend(options.backend);
    this.#persistentBackend = this.#backend === 'memory' ? undefined : this.#backend;
    if (this.#backend === 'memory') this.#warning = MEMORY_ONLY_WARNING;
  }

  get root(): string {
    return this.#root;
  }

  get backend(): SessionEnvironmentBackend {
    return this.#backend;
  }

  /**
   * Load values for a child process. This is intentionally named so it is not
   * mistaken for a UI read API; UI code should use `status()` or `names()`.
   */
  async loadForExecution(scope: SessionEnvironmentScope): Promise<EnvironmentMap> {
    const expected = normalizedScope(scope);
    return enqueueEnvironmentOperation(
      scopeLockKey(this.#root, expected),
      () => withFileLock(this.#root, expected, async () => {
        const values = await this.#loadUnlocked(expected);
        return Object.freeze(cloneEnvironment(values));
      }),
    );
  }

  /** Add or replace the named variables and return only safe status. */
  async set(scope: SessionEnvironmentScope, values: EnvironmentMap): Promise<SessionEnvironmentStatus> {
    const expected = normalizedScope(scope);
    const additions = normalizeEnvironmentMap(values);
    return enqueueEnvironmentOperation(
      scopeLockKey(this.#root, expected),
      () => withFileLock(this.#root, expected, async () => {
        const current = await this.#loadUnlocked(expected);
        const next = { ...current, ...additions };
        await this.#saveUnlocked(expected, next);
        return this.#status(expected, Object.keys(next));
      }),
    );
  }

  /** Replace the complete environment for a session. */
  async replace(scope: SessionEnvironmentScope, values: EnvironmentMap): Promise<SessionEnvironmentStatus> {
    const expected = normalizedScope(scope);
    const replacement = normalizeEnvironmentMap(values);
    return enqueueEnvironmentOperation(
      scopeLockKey(this.#root, expected),
      () => withFileLock(this.#root, expected, async () => {
        await this.#saveUnlocked(expected, replacement);
        return this.#status(expected, Object.keys(replacement));
      }),
    );
  }

  /** Parse and persist pasted dotenv text without returning its values. */
  async importDotEnv(scope: SessionEnvironmentScope, source: string): Promise<SessionEnvironmentStatus> {
    return this.replace(scope, parseDotEnv(source));
  }

  /** Read one explicitly requested dotenv file, then persist only its parsed values. */
  async importFile(scope: SessionEnvironmentScope, file: string): Promise<SessionEnvironmentStatus> {
    const expected = normalizedScope(scope);
    if (typeof file !== 'string' || file.trim().length === 0) {
      throw new PlifError('INVALID_ARGUMENT', 'a dotenv file path is required');
    }
    const target = path.resolve(expected.workspace, file);
    if (!isPathInside(expected.workspace, target)) {
      throw new PlifError('INVALID_ARGUMENT', 'the dotenv file must be inside the active workspace');
    }
    const basename = path.basename(target).toLowerCase();
    if (basename !== '.env' && !basename.startsWith('.env.') && !basename.endsWith('.env')) {
      throw new PlifError('INVALID_ARGUMENT', 'import expects a dotenv file', {
        hint: 'Use a file named .env, .env.local, or *.env.',
      });
    }
    let workspaceRealpath: string;
    let targetRealpath: string;
    let stat;
    try {
      workspaceRealpath = await fs.realpath(expected.workspace);
      targetRealpath = await fs.realpath(target);
      stat = await fs.stat(target);
    } catch {
      throw new PlifError('INVALID_ARGUMENT', 'the requested dotenv file was not found');
    }
    if (!isPathInside(workspaceRealpath, targetRealpath)) {
      throw new PlifError('INVALID_ARGUMENT', 'the dotenv file must resolve inside the active workspace');
    }
    if (!stat.isFile()) throw new PlifError('INVALID_ARGUMENT', 'the requested dotenv path is not a file');
    if (stat.size > MAX_ENV_DOCUMENT_BYTES) {
      throw new PlifError('INVALID_ARGUMENT', 'the dotenv file is too large', {
        hint: 'Keep imports below 2 MiB.',
      });
    }
    const source = await fs.readFile(target, 'utf8');
    return this.importDotEnv(expected, source);
  }

  /** Remove names only; values supplied in an object are deliberately ignored. */
  async remove(
    scope: SessionEnvironmentScope,
    selection: EnvironmentNameSelection,
  ): Promise<SessionEnvironmentStatus> {
    const expected = normalizedScope(scope);
    const names = normalizeEnvironmentNames(selection);
    return enqueueEnvironmentOperation(
      scopeLockKey(this.#root, expected),
      () => withFileLock(this.#root, expected, async () => {
        const current = await this.#loadUnlocked(expected);
        const next = { ...current };
        for (const name of names) delete next[name];
        await this.#saveUnlocked(expected, next);
        return this.#status(expected, Object.keys(next));
      }),
    );
  }

  async clear(scope: SessionEnvironmentScope): Promise<SessionEnvironmentStatus> {
    const expected = normalizedScope(scope);
    return enqueueEnvironmentOperation(
      scopeLockKey(this.#root, expected),
      () => withFileLock(this.#root, expected, async () => {
        await this.#saveUnlocked(expected, {});
        return this.#status(expected, []);
      }),
    );
  }

  /** Safe UI listing: names are allowed, values never cross this boundary. */
  async names(scope: SessionEnvironmentScope): Promise<readonly string[]> {
    const status = await this.status(scope);
    return status.names;
  }

  /** Safe UI status: no encrypted payload, plaintext value or crypto error is returned. */
  async status(scope: SessionEnvironmentScope): Promise<SessionEnvironmentStatus> {
    const expected = normalizedScope(scope);
    return enqueueEnvironmentOperation(
      scopeLockKey(this.#root, expected),
      () => withFileLock(this.#root, expected, async () => {
        const values = await this.#loadUnlocked(expected);
        return this.#status(expected, Object.keys(values));
      }),
    );
  }

  #status(scope: SessionEnvironmentScope, names: readonly string[]): SessionEnvironmentStatus {
    const safeNames = [...new Set(names)].sort();
    const key = scopeDigest(scope);
    const warning = this.#blockedPersistentKeys.has(key)
      ? PERSISTENT_RECORD_UNAVAILABLE_WARNING
      : this.#warning;
    return {
      scope,
      backend: this.#backend,
      persistent: this.#backend !== 'memory',
      secureBackendAvailable: this.#backend !== 'memory',
      names: safeNames,
      ...(warning ? { warning } : {}),
    };
  }

  #file(scope: SessionEnvironmentScope): string {
    if (!this.#persistentBackend) {
      throw new Error('no persistent session-environment backend selected');
    }
    return this.#fileForBackend(scope, this.#persistentBackend);
  }

  #fileForBackend(scope: SessionEnvironmentScope, backend: PersistentEnvironmentBackend): string {
    const extension = backend === 'windows-dpapi' ? 'dpapi' : 'cred';
    return path.join(
      this.#root,
      workspaceDigest(scope.workspace),
      `${scopeDigest(scope)}.${extension}`,
    );
  }

  async #removePersisted(scope: SessionEnvironmentScope): Promise<void> {
    // `clear` is an explicit user action. Remove either known envelope so a
    // backend change (or a store opened in memory-only mode) cannot leave an
    // older encrypted record that silently comes back in a later process.
    await Promise.all(
      PERSISTENT_ENVIRONMENT_BACKENDS.map((backend) =>
        fs.rm(this.#fileForBackend(scope, backend), { force: true }),
      ),
    );
  }

  async #hasPersistedRecord(scope: SessionEnvironmentScope): Promise<boolean> {
    for (const backend of PERSISTENT_ENVIRONMENT_BACKENDS) {
      if (await pathExists(this.#fileForBackend(scope, backend))) return true;
    }
    return false;
  }

  #credentialName(scope: SessionEnvironmentScope): string {
    return `plif-env-${scopeDigest(scope)}`;
  }

  async #loadUnlocked(scope: SessionEnvironmentScope): Promise<Record<string, string>> {
    const key = scopeDigest(scope);
    if (this.#backend === 'memory') {
      if (await this.#hasPersistedRecord(scope)) this.#blockedPersistentKeys.add(key);
      return cloneEnvironment(this.#memory.get(key) ?? {});
    }

    try {
      const encrypted = await fs.readFile(this.#file(scope), 'utf8');
      const clear = this.#persistentBackend === 'windows-dpapi'
        ? await this.#dpapi('unprotect', encrypted)
        : await this.#systemdCreds('unprotect', encrypted, this.#credentialName(scope));
      return parseStoredRecord(clear, scope);
    } catch (error) {
      if (isMissing(error)) return {};
      // A failed decrypt, unavailable helper or malformed record never falls
      // back to plaintext. Keep only values already supplied in this process,
      // and remember that this scope has durable state we must not overwrite
      // while the secure backend is unavailable.
      this.#blockedPersistentKeys.add(key);
      this.#degradeToMemory(key);
      return cloneEnvironment(this.#memory.get(key) ?? {});
    }
  }

  async #saveUnlocked(scope: SessionEnvironmentScope, values: EnvironmentMap): Promise<void> {
    const normalized = normalizeEnvironmentMap(values);
    const key = scopeDigest(scope);
    if (this.#backend === 'memory') {
      if (this.#blockedPersistentKeys.has(key) || await this.#hasPersistedRecord(scope)) {
        if (Object.keys(normalized).length === 0) {
          await this.#removePersisted(scope);
          this.#blockedPersistentKeys.delete(key);
          this.#memory.delete(key);
          return;
        }
        throw new PlifError('INTERNAL', PERSISTENT_RECORD_UNAVAILABLE_WARNING, {
          hint: 'Restore the secure credential backend, or use /env clear to remove the old record deliberately.',
        });
      }
      this.#memory.set(key, normalized);
      return;
    }

    if (this.#blockedPersistentKeys.has(key)) {
      if (Object.keys(normalized).length === 0) {
        await this.#removePersisted(scope);
        this.#blockedPersistentKeys.delete(key);
        this.#memory.delete(key);
        return;
      }
      throw new PlifError('INTERNAL', PERSISTENT_RECORD_UNAVAILABLE_WARNING, {
        hint: 'Restore the secure credential backend, or use /env clear to remove the old record deliberately.',
      });
    }

    const destination = this.#file(scope);
    const hadPersistentRecord = await pathExists(destination);
    try {
      if (Object.keys(normalized).length === 0) {
        await this.#removePersisted(scope);
        this.#blockedPersistentKeys.delete(key);
        this.#memory.delete(key);
        return;
      }

      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const record = JSON.stringify(storedRecord(scope, normalized));
      const encrypted = this.#persistentBackend === 'windows-dpapi'
        ? await this.#dpapi('protect', record)
        : await this.#systemdCreds('protect', record, this.#credentialName(scope));

      if (typeof encrypted !== 'string' || encrypted.length === 0 || containsPlaintext(encrypted, record)) {
        throw new Error('secure environment helper returned unsafe output');
      }

      const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
      let committed = false;
      try {
        await fs.writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, destination);
        committed = true;
      } finally {
        if (!committed) await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
      this.#memory.delete(key);
    } catch {
      // Never create a cleartext fallback. A new record may continue in process
      // memory, but an existing encrypted record is left untouched and writes
      // fail closed so it cannot be silently resurrected later.
      if (hadPersistentRecord || await pathExists(destination)) {
        this.#blockedPersistentKeys.add(key);
        this.#degradeToMemory(key, normalized);
        throw new PlifError('INTERNAL', PERSISTENT_RECORD_UNAVAILABLE_WARNING, {
          hint: 'Restore the secure credential backend, or use /env clear to remove the old record deliberately.',
        });
      }
      this.#degradeToMemory(key, normalized);
    }
  }

  #degradeToMemory(key: string, values?: EnvironmentMap): void {
    this.#backend = 'memory';
    this.#warning = MEMORY_ONLY_WARNING;
    if (values !== undefined) this.#memory.set(key, cloneEnvironment(values));
  }
}

/** Select the native encrypted backend, or the explicit process-memory fallback. */
export function platformSessionEnvironmentStore(root?: string): SessionEnvironmentStore {
  return new SessionEnvironmentStore({ ...(root ? { root } : {}) });
}

function containsPlaintext(encrypted: string, clearRecord: string): boolean {
  // A secure helper may return a textual envelope, so checking for individual
  // short values would create false positives (for example, a one-character
  // value can occur by chance in base64). Reject the unencrypted record itself,
  // including a helper that merely wrapped it with a prefix or suffix.
  return encrypted === clearRecord || encrypted.includes(clearRecord);
}

function selectBackend(requested: SessionEnvironmentStoreOptions['backend']): SessionEnvironmentBackend {
  if (requested && requested !== 'auto') return requested;
  if (process.platform === 'win32') return 'windows-dpapi';
  if (process.platform === 'linux' && canUseSystemdCreds()) return 'linux-systemd-creds';
  return 'memory';
}
