import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { PlifError } from '../errors.js';

export type OAuthCredentialScope = 'all' | 'client' | 'tokens' | 'verifier' | 'discovery';

/** The one durable home for Plif-owned MCP OAuth records. */
export function personalOAuthStorePath(home = os.homedir()): string {
  return path.join(home, '.plif', 'oauth');
}

export interface StoredMcpOAuthState {
  readonly tokens?: OAuthTokens;
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly codeVerifier?: string;
  readonly discoveryState?: OAuthDiscoveryState;
}

export interface McpOAuthStore {
  load(key: string): Promise<StoredMcpOAuthState | undefined>;
  save(key: string, state: StoredMcpOAuthState): Promise<void>;
  clear(key: string, scope: OAuthCredentialScope): Promise<void>;
}

function clone(state: StoredMcpOAuthState): StoredMcpOAuthState {
  return structuredClone(state);
}

export class MemoryMcpOAuthStore implements McpOAuthStore {
  readonly #records = new Map<string, StoredMcpOAuthState>();

  constructor(initial: Readonly<Record<string, StoredMcpOAuthState>> = {}) {
    for (const [key, state] of Object.entries(initial)) this.#records.set(key, clone(state));
  }

  async load(key: string): Promise<StoredMcpOAuthState | undefined> {
    const state = this.#records.get(key);
    return state ? clone(state) : undefined;
  }

  async save(key: string, state: StoredMcpOAuthState): Promise<void> {
    this.#records.set(key, clone(state));
  }

  async clear(key: string, scope: OAuthCredentialScope): Promise<void> {
    if (scope === 'all') {
      this.#records.delete(key);
      return;
    }
    const state = this.#records.get(key);
    if (!state) return;
    const next = { ...state } as Record<string, unknown>;
    delete next[scope === 'client' ? 'clientInformation' : scope === 'verifier' ? 'codeVerifier' : `${scope}State`];
    if (scope === 'tokens') delete next['tokens'];
    if (Object.keys(next).length === 0) this.#records.delete(key);
    else this.#records.set(key, next as StoredMcpOAuthState);
  }
}

export type DpapiRunner = (mode: 'protect' | 'unprotect', input: string) => Promise<string>;
export type SystemdCredsRunner = (
  mode: 'protect' | 'unprotect',
  input: string,
  name: string,
) => Promise<string>;

const PROTECT_SCRIPT =
  '$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString $v -AsPlainText -Force;[Console]::Out.Write((ConvertFrom-SecureString $s))';
const UNPROTECT_SCRIPT =
  '$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString $v;$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}';

const CREDENTIAL_COMMAND_TIMEOUT_MS = 30_000;

/** Run a credential helper with one idempotent completion path and a timeout. */
function runCredentialCommand(
  command: string,
  args: readonly string[],
  input: string,
  description: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The process may already have exited between the timer and kill.
      }
      finish(new PlifError('INTERNAL', `${description} timed out`));
    }, CREDENTIAL_COMMAND_TIMEOUT_MS);
    timer.unref?.();

    const finish = (error?: PlifError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };

    child.stdout.setEncoding('utf8').on('data', (part: string) => (output += part));
    // Helper diagnostics can contain command input or other sensitive context;
    // consume them, but never copy them into a PlifError or audit record.
    child.stderr.resume();
    child.once('error', (error) => finish(new PlifError('INTERNAL', `${description} failed`, { cause: error })));
    child.once('close', (code) => {
      if (code === 0) finish();
      else finish(new PlifError('INTERNAL', `${description} failed`));
    });
    child.stdin.end(input);
  });
}

export async function runWindowsDpapi(mode: 'protect' | 'unprotect', input: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new PlifError('INTERNAL', 'Windows DPAPI is unavailable on this platform');
  }
  return runCredentialCommand(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      mode === 'protect' ? PROTECT_SCRIPT : UNPROTECT_SCRIPT,
    ],
    input,
    'Windows DPAPI',
  );
}

export async function runSystemdCreds(
  mode: 'protect' | 'unprotect',
  input: string,
  name: string,
): Promise<string> {
  if (process.platform !== 'linux') {
    throw new PlifError('INTERNAL', 'systemd credentials are unavailable on this platform');
  }
  const args = mode === 'protect'
    ? ['encrypt', '--with-key=host', `--name=${name}`, '-', '-']
    : ['decrypt', `--name=${name}`, '-', '-'];
  return runCredentialCommand('systemd-creds', args, input, 'systemd credentials');
}

export function canUseSystemdCreds(): boolean {
  if (process.platform !== 'linux') return false;
  const result = spawnSync(
    'systemd-creds',
    ['encrypt', '--with-key=host', '--name=plif-probe', '-', '-'],
    { encoding: 'utf8', input: 'probe', timeout: 5_000, windowsHide: true },
  );
  return result.status === 0 && result.error === undefined;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function mcpOAuthKey(server: string, url: string): string {
  const endpoint = new URL(url);
  return hash(`${server}\n${endpoint.origin}${endpoint.pathname}`);
}

export class WindowsDpapiOAuthStore implements McpOAuthStore {
  constructor(
    private readonly root = personalOAuthStorePath(),
    private readonly dpapi: DpapiRunner = runWindowsDpapi,
  ) {}

  async load(key: string): Promise<StoredMcpOAuthState | undefined> {
    try {
      const encrypted = await readFile(this.file(key), 'utf8');
      return JSON.parse(await this.dpapi('unprotect', encrypted)) as StoredMcpOAuthState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new PlifError('INTERNAL', 'could not read the Windows OAuth credential store', { cause: error });
    }
  }

  async save(key: string, state: StoredMcpOAuthState): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const destination = this.file(key);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const encrypted = await this.dpapi('protect', JSON.stringify(state));
      await writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new PlifError('INTERNAL', 'could not write the Windows OAuth credential store', { cause: error });
    }
  }

  async clear(key: string, scope: OAuthCredentialScope): Promise<void> {
    if (scope === 'all') {
      await rm(this.file(key), { force: true });
      return;
    }
    const state = await this.load(key);
    if (!state) return;
    const memory = new MemoryMcpOAuthStore({ [key]: state });
    await memory.clear(key, scope);
    const next = await memory.load(key);
    if (next) await this.save(key, next);
    else await rm(this.file(key), { force: true });
  }

  private file(key: string): string {
    return path.join(this.root, `${hash(key)}.dpapi`);
  }
}

export class SystemdCredsOAuthStore implements McpOAuthStore {
  constructor(
    private readonly root = personalOAuthStorePath(),
    private readonly crypt: SystemdCredsRunner = runSystemdCreds,
  ) {}

  async load(key: string): Promise<StoredMcpOAuthState | undefined> {
    try {
      const encrypted = await readFile(this.file(key), 'utf8');
      const record = JSON.parse(
        await this.crypt('unprotect', encrypted, oauthCredentialName(key)),
      ) as { key?: string; state?: StoredMcpOAuthState };
      if (record.key !== key || !record.state) {
        throw new PlifError('INTERNAL', 'Linux OAuth credential binding does not match');
      }
      return record.state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new PlifError('INTERNAL', 'could not read the Linux OAuth credential store', { cause: error });
    }
  }

  async save(key: string, state: StoredMcpOAuthState): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const destination = this.file(key);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const encrypted = await this.crypt(
        'protect',
        JSON.stringify({ key, state }),
        oauthCredentialName(key),
      );
      await writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new PlifError('INTERNAL', 'could not write the Linux OAuth credential store', { cause: error });
    }
  }

  async clear(key: string, scope: OAuthCredentialScope): Promise<void> {
    if (scope === 'all') {
      await rm(this.file(key), { force: true });
      return;
    }
    const state = await this.load(key);
    if (!state) return;
    const memory = new MemoryMcpOAuthStore({ [key]: state });
    await memory.clear(key, scope);
    const next = await memory.load(key);
    if (next) await this.save(key, next);
    else await rm(this.file(key), { force: true });
  }

  private file(key: string): string {
    return path.join(this.root, `${hash(key)}.cred`);
  }
}

export function platformMcpOAuthStore(): McpOAuthStore {
  if (process.platform === 'win32') return new WindowsDpapiOAuthStore();
  if (canUseSystemdCreds()) return new SystemdCredsOAuthStore();
  return new MemoryMcpOAuthStore();
}

function oauthCredentialName(key: string): string {
  return `plif-oauth-${hash(key)}`;
}
