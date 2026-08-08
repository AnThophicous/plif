import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const PROTECT_SCRIPT =
  '$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString $v -AsPlainText -Force;[Console]::Out.Write((ConvertFrom-SecureString $s))';
const UNPROTECT_SCRIPT =
  '$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString $v;$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}';

export async function runWindowsDpapi(mode: 'protect' | 'unprotect', input: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new PlifError('INTERNAL', 'Windows DPAPI is unavailable on this platform');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', mode === 'protect' ? PROTECT_SCRIPT : UNPROTECT_SCRIPT],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (part: string) => (output += part));
    child.stderr.resume();
    child.once('error', (error) => reject(new PlifError('INTERNAL', 'Windows DPAPI failed', { cause: error })));
    child.once('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new PlifError('INTERNAL', 'Windows DPAPI failed'));
    });
    child.stdin.end(input);
  });
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
    private readonly root = path.join(os.homedir(), '.config', 'PlifCode', 'oauth'),
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
    const temporary = `${destination}.${process.pid}.tmp`;
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
