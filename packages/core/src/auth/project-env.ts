import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PlifError } from '../errors.js';
import {
  platformProjectSecretBackend,
  type ProjectSecretBackend,
} from './credential-backends.js';
import {
  normalizeEnvironmentMap,
  normalizeEnvironmentNames,
  parseDotEnv,
  personalSessionEnvironmentPath,
  SessionEnvironmentStore,
  validateEnvironmentName,
  type EnvironmentMap,
} from './session-env.js';

export type ProjectEnvironmentBackend =
  | 'windows-credential-manager'
  | 'linux-secret-service'
  | 'encrypted-fallback'
  | 'memory';

export interface ProjectEnvironmentScope {
  readonly workspace: string;
}

export interface ProjectEnvironmentStatus {
  readonly scope: ProjectEnvironmentScope;
  readonly backend: ProjectEnvironmentBackend;
  readonly persistent: boolean;
  readonly secureBackendAvailable: boolean;
  readonly names: readonly string[];
  readonly warning?: string;
}

export interface ProjectEnvironmentStoreOptions {
  readonly root?: string;
  readonly backend?: 'auto' | ProjectEnvironmentBackend;
  readonly native?: ProjectSecretBackend;
  readonly passphrase?: string | (() => Promise<string | undefined>);
  readonly legacySessionRoot?: string;
}

const MEMORY_WARNING = 'The native credential store is unavailable; project secrets are encrypted locally with a passphrase.';
const MEMORY_ONLY_WARNING = 'No secure persistent store is available; project secrets remain in memory for this process only.';
const FALLBACK_VERSION = 1;
const NATIVE_VERSION = 1;

export function personalProjectEnvironmentPath(home = os.homedir()): string {
  return path.join(home, '.plif', 'project-env');
}

function normalizedScope(scope: ProjectEnvironmentScope): ProjectEnvironmentScope {
  if (scope === null || typeof scope !== 'object' || typeof scope.workspace !== 'string' || scope.workspace.includes('\0')) {
    throw new PlifError('INVALID_ARGUMENT', 'project environment scope is invalid');
  }
  return { workspace: path.resolve(scope.workspace) };
}

function workspaceKey(workspace: string): string {
  let normalized = path.resolve(workspace);
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function clone(values: EnvironmentMap): Record<string, string> {
  return { ...values };
}

function safePassphrase(value: string | undefined): string {
  if (!value) throw new PlifError('INVALID_ARGUMENT', 'a passphrase is required for the encrypted project environment');
  if (value.length < 12) throw new PlifError('INVALID_ARGUMENT', 'the project environment passphrase must be at least 12 characters');
  return value;
}

interface FallbackEnvelope {
  readonly version: 1;
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

interface NativeEnvelope {
  readonly version: 1;
  readonly target: string;
  readonly values: EnvironmentMap;
}

export class ProjectEnvironmentStore {
  readonly #root: string;
  readonly #selected: ProjectEnvironmentBackend;
  readonly #native: ProjectSecretBackend | null;
  readonly #passphrase: ProjectEnvironmentStoreOptions['passphrase'];
  readonly #legacy: SessionEnvironmentStore;
  readonly #memory = new Map<string, Record<string, string>>();
  #passphraseCache: string | undefined;
  #fallbackActive = false;

  constructor(options: ProjectEnvironmentStoreOptions = {}) {
    this.#root = path.resolve(options.root ?? personalProjectEnvironmentPath());
    this.#selected = selectBackend(options.backend);
    this.#passphrase = options.passphrase;
    const native = options.native ?? platformProjectSecretBackend();
    this.#native = isNativeBackend(this.#selected) && native?.kind === this.#selected ? native : null;
    this.#legacy = new SessionEnvironmentStore({
      root: options.legacySessionRoot ?? personalSessionEnvironmentPath(),
    });
  }

  get root(): string {
    return this.#root;
  }

  get backend(): ProjectEnvironmentBackend {
    return this.#fallbackActive ? 'encrypted-fallback' : this.#selected;
  }

  lock(): void {
    this.#passphraseCache = undefined;
    this.#memory.clear();
  }

  async loadForExecution(scope: ProjectEnvironmentScope): Promise<EnvironmentMap> {
    const expected = normalizedScope(scope);
    return Object.freeze(clone(await this.#load(expected)));
  }

  async set(scope: ProjectEnvironmentScope, values: EnvironmentMap): Promise<ProjectEnvironmentStatus> {
    const expected = normalizedScope(scope);
    const additions = normalizeEnvironmentMap(values);
    const current = await this.#load(expected);
    await this.#save(expected, { ...current, ...additions });
    return this.status(expected);
  }

  async replace(scope: ProjectEnvironmentScope, values: EnvironmentMap): Promise<ProjectEnvironmentStatus> {
    const expected = normalizedScope(scope);
    await this.#save(expected, normalizeEnvironmentMap(values));
    return this.status(expected);
  }

  async importDotEnv(scope: ProjectEnvironmentScope, source: string): Promise<ProjectEnvironmentStatus> {
    return this.replace(scope, parseDotEnv(source));
  }

  async importFile(scope: ProjectEnvironmentScope, file: string): Promise<ProjectEnvironmentStatus> {
    const expected = normalizedScope(scope);
    if (typeof file !== 'string' || !file.trim()) throw new PlifError('INVALID_ARGUMENT', 'a dotenv file path is required');
    const target = path.resolve(expected.workspace, file);
    const relative = path.relative(expected.workspace, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new PlifError('INVALID_ARGUMENT', 'the dotenv file must be inside the active workspace');
    }
    const name = path.basename(target).toLowerCase();
    if (name !== '.env' && !name.startsWith('.env.') && !name.endsWith('.env')) {
      throw new PlifError('INVALID_ARGUMENT', 'import expects a dotenv file');
    }
    let source: string;
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('invalid dotenv file');
      source = await fs.readFile(target, 'utf8');
    } catch {
      throw new PlifError('INVALID_ARGUMENT', 'the requested dotenv file was not found');
    }
    return this.importDotEnv(expected, source);
  }

  async remove(scope: ProjectEnvironmentScope, selection: readonly string[] | Readonly<Record<string, unknown>>): Promise<ProjectEnvironmentStatus> {
    const expected = normalizedScope(scope);
    const current = await this.#load(expected);
    const next = { ...current };
    for (const name of normalizeEnvironmentNames(selection)) delete next[name];
    await this.#save(expected, next);
    return this.status(expected);
  }

  async clear(scope: ProjectEnvironmentScope): Promise<ProjectEnvironmentStatus> {
    const expected = normalizedScope(scope);
    await this.#save(expected, {});
    return this.status(expected);
  }

  async names(scope: ProjectEnvironmentScope): Promise<readonly string[]> {
    return (await this.status(scope)).names;
  }

  async status(scope: ProjectEnvironmentScope): Promise<ProjectEnvironmentStatus> {
    const expected = normalizedScope(scope);
    const values = await this.#load(expected);
    if (await this.#nativeReady()) {
      return {
        scope: expected,
        backend: this.#selected,
        persistent: true,
        secureBackendAvailable: true,
        names: Object.keys(values).sort(),
      };
    }
    if (this.#fallbackActive || this.#selected === 'encrypted-fallback') {
      return {
        scope: expected,
        backend: 'encrypted-fallback',
        persistent: true,
        secureBackendAvailable: false,
        names: Object.keys(values).sort(),
        warning: MEMORY_WARNING,
      };
    }
    return {
      scope: expected,
      backend: 'memory',
      persistent: false,
      secureBackendAvailable: false,
      names: Object.keys(values).sort(),
      warning: MEMORY_ONLY_WARNING,
    };
  }

  async migrateLegacySession(scope: ProjectEnvironmentScope, sessionId: string): Promise<boolean> {
    const expected = normalizedScope(scope);
    const current = await this.#load(expected);
    if (Object.keys(current).length > 0) return false;
    const legacy = await this.#legacy.loadForExecution({ workspace: expected.workspace, sessionId });
    if (Object.keys(legacy).length === 0) return false;
    await this.#save(expected, legacy);
    return true;
  }

  async #nativeReady(): Promise<boolean> {
    if (!this.#native || this.#fallbackActive) return false;
    if (await this.#native.isAvailable()) return true;
    this.#fallbackActive = Boolean(this.#passphrase);
    return false;
  }

  async #load(scope: ProjectEnvironmentScope): Promise<Record<string, string>> {
    if (await this.#nativeReady()) {
      const target = this.#nativeTarget(scope);
      const encoded = await this.#native!.load(target);
      if (encoded === undefined) return {};
      return this.#parseNative(encoded, target);
    }
    if (this.#fallbackActive || this.#selected === 'encrypted-fallback') return this.#loadFallback(scope);
    return clone(this.#memory.get(workspaceKey(scope.workspace)) ?? {});
  }

  async #save(scope: ProjectEnvironmentScope, values: EnvironmentMap): Promise<void> {
    const normalized = normalizeEnvironmentMap(values);
    if (await this.#nativeReady()) {
      const target = this.#nativeTarget(scope);
      if (Object.keys(normalized).length === 0) {
        await this.#native!.clear(target);
      } else {
        const envelope: NativeEnvelope = {
          version: NATIVE_VERSION,
          target,
          values: normalized,
        };
        await this.#native!.save(target, JSON.stringify(envelope));
      }
      this.#memory.delete(workspaceKey(scope.workspace));
      return;
    }
    if (this.#fallbackActive || this.#selected === 'encrypted-fallback') {
      await this.#saveFallback(scope, normalized);
      return;
    }
    this.#memory.set(workspaceKey(scope.workspace), clone(normalized));
  }

  async #passphraseValue(): Promise<string> {
    if (this.#passphraseCache !== undefined) return this.#passphraseCache;
    const value = typeof this.#passphrase === 'function' ? await this.#passphrase() : this.#passphrase;
    this.#passphraseCache = safePassphrase(value);
    return this.#passphraseCache;
  }

  #nativeTarget(scope: ProjectEnvironmentScope): string {
    return `plif-project-environment-${workspaceKey(scope.workspace)}`;
  }

  #fallbackFile(scope: ProjectEnvironmentScope): string {
    return path.join(this.#root, `${workspaceKey(scope.workspace)}.vault`);
  }

  #parseNative(encoded: string, target: string): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(encoded);
      if (
        parsed === null || typeof parsed !== 'object' ||
        (parsed as Partial<NativeEnvelope>).version !== NATIVE_VERSION ||
        (parsed as Partial<NativeEnvelope>).target !== target
      ) throw new Error('binding');
      return normalizeEnvironmentMap((parsed as NativeEnvelope).values);
    } catch {
      throw new PlifError('INTERNAL', 'the project environment record is invalid or bound to another project');
    }
  }

  async #loadFallback(scope: ProjectEnvironmentScope): Promise<Record<string, string>> {
    const key = workspaceKey(scope.workspace);
    const cached = this.#memory.get(key);
    if (cached) return clone(cached);
    let encoded: string;
    try {
      encoded = await fs.readFile(this.#fallbackFile(scope), 'utf8');
    } catch (error) {
      if (isMissing(error)) return {};
      throw new PlifError('INTERNAL', 'the encrypted project environment could not be read');
    }
    const passphrase = await this.#passphraseValue();
    try {
      const envelope = JSON.parse(encoded) as FallbackEnvelope;
      if (envelope.version !== FALLBACK_VERSION) throw new Error('version');
      const keyBytes = scryptSync(passphrase, Buffer.from(envelope.salt, 'base64'), 32);
      const decipher = createDecipheriv('aes-256-gcm', keyBytes, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      const normalized = normalizeEnvironmentMap(JSON.parse(clear) as Record<string, string>);
      this.#memory.set(key, normalized);
      return clone(normalized);
    } catch {
      throw new PlifError('INTERNAL', 'the project environment passphrase is incorrect or the vault is damaged');
    }
  }

  async #saveFallback(scope: ProjectEnvironmentScope, values: EnvironmentMap): Promise<void> {
    const normalized = normalizeEnvironmentMap(values);
    const key = workspaceKey(scope.workspace);
    const file = this.#fallbackFile(scope);
    if (Object.keys(normalized).length === 0) {
      await fs.rm(file, { force: true });
      this.#memory.delete(key);
      return;
    }
    const passphrase = await this.#passphraseValue();
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const keyBytes = scryptSync(passphrase, salt, 32);
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalized), 'utf8'), cipher.final()]);
    const envelope: FallbackEnvelope = {
      version: FALLBACK_VERSION,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, file);
      this.#memory.set(key, clone(normalized));
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function isNativeBackend(backend: ProjectEnvironmentBackend): backend is 'windows-credential-manager' | 'linux-secret-service' {
  return backend === 'windows-credential-manager' || backend === 'linux-secret-service';
}

function selectBackend(requested: ProjectEnvironmentStoreOptions['backend']): ProjectEnvironmentBackend {
  if (requested && requested !== 'auto') return requested;
  if (process.platform === 'win32') return 'windows-credential-manager';
  if (process.platform === 'linux') return 'linux-secret-service';
  return 'encrypted-fallback';
}

export {
  normalizeEnvironmentMap,
  normalizeEnvironmentNames,
  parseDotEnv,
  validateEnvironmentName,
};
export type { EnvironmentMap } from './session-env.js';
export type { ProjectSecretBackend } from './credential-backends.js';
