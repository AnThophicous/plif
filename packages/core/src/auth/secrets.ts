import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PlifError } from '../errors.js';
import {
  runSystemdCreds,
  runWindowsDpapi,
  canUseSystemdCreds,
  type DpapiRunner,
  type SystemdCredsRunner,
} from './store.js';

export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  names(): Promise<string[]>;
}

/** The one durable home for Plif-owned credentials. */
export function personalSecretStorePath(home = os.homedir()): string {
  return path.join(home, '.plif', 'secrets');
}

export class MemorySecretStore implements SecretStore {
  readonly #values = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [name, value] of Object.entries(initial)) this.#values.set(name, value);
  }

  async get(name: string): Promise<string | undefined> {
    return this.#values.get(name);
  }

  async set(name: string, value: string): Promise<void> {
    this.#values.set(name, value);
  }

  async delete(name: string): Promise<void> {
    this.#values.delete(name);
  }

  async names(): Promise<string[]> {
    return [...this.#values.keys()].sort();
  }
}

/**
 * Credentials the developer typed, encrypted with their Windows account.
 *
 * One file per name, holding the value and the name it was stored under. The
 * name is inside the encrypted record rather than in the filename so that a
 * directory listing does not reveal which services someone uses; the filename
 * is a hash, which is enough to find the record again.
 */
export class WindowsDpapiSecretStore implements SecretStore {
  constructor(
    private readonly root = personalSecretStorePath(),
    private readonly dpapi: DpapiRunner = runWindowsDpapi,
  ) {}

  async get(name: string): Promise<string | undefined> {
    try {
      const encrypted = await readFile(this.file(name), 'utf8');
      const record = JSON.parse(await this.dpapi('unprotect', encrypted)) as { name?: string; value?: string };
      if (record.name !== name) throw new PlifError('INTERNAL', 'Windows credential binding does not match');
      return typeof record.value === 'string' ? record.value : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new PlifError('INTERNAL', 'could not read the credential store', { cause: error });
    }
  }

  async set(name: string, value: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const destination = this.file(name);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const encrypted = await this.dpapi('protect', JSON.stringify({ name, value }));
      await writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new PlifError('INTERNAL', 'could not write the credential store', { cause: error });
    }
  }

  async delete(name: string): Promise<void> {
    await rm(this.file(name), { force: true });
  }

  async names(): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.root);
    } catch {
      return [];
    }
    const names: string[] = [];
    for (const file of files.filter((entry) => entry.endsWith('.dpapi'))) {
      try {
        const encrypted = await readFile(path.join(this.root, file), 'utf8');
        const record = JSON.parse(await this.dpapi('unprotect', encrypted)) as { name?: string };
        if (typeof record.name === 'string') names.push(record.name);
      } catch {
        // Unreadable records are not worth failing a listing over.
      }
    }
    return names.sort();
  }

  private file(name: string): string {
    return path.join(this.root, `${createHash('sha256').update(name).digest('hex')}.dpapi`);
  }
}

export class SystemdCredsSecretStore implements SecretStore {
  constructor(
    private readonly root = personalSecretStorePath(),
    private readonly crypt: SystemdCredsRunner = runSystemdCreds,
  ) {}

  async get(name: string): Promise<string | undefined> {
    try {
      const encrypted = await readFile(this.file(name), 'utf8');
      const record = JSON.parse(
        await this.crypt('unprotect', encrypted, secretCredentialName(name)),
      ) as { name?: string; value?: string };
      if (record.name !== name) throw new PlifError('INTERNAL', 'Linux credential binding does not match');
      return typeof record.value === 'string' ? record.value : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new PlifError('INTERNAL', 'could not read the Linux credential store', { cause: error });
    }
  }

  async set(name: string, value: string): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const destination = this.file(name);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const encrypted = await this.crypt(
        'protect',
        JSON.stringify({ name, value }),
        secretCredentialName(name),
      );
      await writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new PlifError('INTERNAL', 'could not write the Linux credential store', { cause: error });
    }
  }

  async delete(name: string): Promise<void> {
    await rm(this.file(name), { force: true });
  }

  async names(): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.root);
    } catch {
      return [];
    }
    const names: string[] = [];
    for (const file of files.filter((entry) => entry.endsWith('.cred'))) {
      try {
        const encrypted = await readFile(path.join(this.root, file), 'utf8');
        const digest = file.slice(0, -'.cred'.length);
        const record = JSON.parse(
          await this.crypt('unprotect', encrypted, `plif-secret-${digest}`),
        ) as { name?: string };
        if (typeof record.name === 'string') names.push(record.name);
      } catch {}
    }
    return names.sort();
  }

  private file(name: string): string {
    return path.join(this.root, `${createHash('sha256').update(name).digest('hex')}.cred`);
  }
}

export function platformSecretStore(): SecretStore {
  if (process.platform === 'win32') return new WindowsDpapiSecretStore();
  if (canUseSystemdCreds()) return new SystemdCredsSecretStore();
  return new MemorySecretStore();
}

function secretCredentialName(name: string): string {
  return `plif-secret-${createHash('sha256').update(name).digest('hex')}`;
}

export interface CredentialRequest {
  /** The environment variable the configuration asked for. */
  readonly variable: string;
  /** Who wants it, in words the developer will recognise. */
  readonly purpose: string;
  readonly hint?: string;
}

export interface CredentialBrokerOptions {
  readonly store: SecretStore;
  /**
   * Collect one credential from the developer, or null when nobody can be
   * asked. Resolving the value through this callback rather than an event is
   * what keeps it off the bus, the transcript and the model's context.
   */
  readonly prompt?: (request: CredentialRequest) => Promise<string | null>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * Where a credential comes from, in order: the environment, then the encrypted
 * store, then the developer.
 *
 * The environment wins so that CI and a one-off `KEY=x plif ...` keep working
 * without ever touching the store, and so a value someone exported to override
 * a saved one actually overrides it.
 */
export class CredentialBroker {
  readonly #store: SecretStore;
  readonly #prompt: ((request: CredentialRequest) => Promise<string | null>) | undefined;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #refused = new Set<string>();

  constructor(options: CredentialBrokerOptions) {
    this.#store = options.store;
    this.#prompt = options.prompt;
    this.#environment = options.environment ?? process.env;
  }

  get interactive(): boolean {
    return this.#prompt !== undefined;
  }

  /** Read an existing credential without prompting the developer. */
  async lookup(variable: string): Promise<string | undefined> {
    const fromEnvironment = this.#environment[variable];
    if (fromEnvironment?.trim()) return fromEnvironment.trim();
    const stored = await this.#store.get(variable);
    return stored?.trim() || undefined;
  }

  /** Read only the encrypted store, ignoring an environment override. */
  async stored(variable: string): Promise<string | undefined> {
    const value = await this.#store.get(variable);
    return value?.trim() || undefined;
  }

  /** Persist a credential without exposing it to configuration or prompts. */
  async remember(variable: string, value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized) throw new PlifError('INVALID_ARGUMENT', 'credential cannot be empty');
    this.#refused.delete(variable);
    await this.#store.set(variable, normalized);
  }

  /** Remove a saved credential and allow a later resolve to ask again. */
  async forget(variable: string): Promise<void> {
    this.#refused.delete(variable);
    await this.#store.delete(variable);
  }

  async resolve(request: CredentialRequest): Promise<string | undefined> {
    const existing = await this.lookup(request.variable);
    if (existing) return existing;

    // Asking twice in one run for something already declined is nagging.
    if (!this.#prompt || this.#refused.has(request.variable)) return undefined;

    const typed = await this.#prompt(request);
    if (!typed?.trim()) {
      this.#refused.add(request.variable);
      return undefined;
    }

    await this.remember(request.variable, typed);
    return typed.trim();
  }

  /** Resolve many, keeping only what was actually found. */
  async resolveAll(requests: readonly CredentialRequest[]): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    for (const request of requests) {
      const value = await this.resolve(request);
      if (value !== undefined) found[request.variable] = value;
    }
    return found;
  }
}
