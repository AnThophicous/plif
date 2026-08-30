import { spawn, spawnSync } from 'node:child_process';

import { loadWindowsCredentialManager } from '@plif/sandbox';

import { PlifError } from '../errors.js';

export interface ProjectSecretBackend {
  readonly kind: 'windows-credential-manager' | 'linux-secret-service';
  isAvailable(): Promise<boolean>;
  load(target: string): Promise<string | undefined>;
  save(target: string, value: string): Promise<void>;
  clear(target: string): Promise<void>;
}

interface SecretToolResult {
  readonly code: number;
  readonly output: string;
}

type SecretToolRunner = (args: readonly string[], input?: string) => Promise<SecretToolResult>;

const COMMAND_TIMEOUT_MS = 30_000;
const CREDENTIAL_NOT_FOUND = 1168;

function runSecretTool(command: string, args: readonly string[], input?: string): Promise<SecretToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (result?: SecretToolResult, error?: PlifError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result as SecretToolResult);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish(undefined, new PlifError('INTERNAL', 'Linux Secret Service timed out'));
    }, COMMAND_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.resume();
    child.once('error', (error) => finish(undefined, new PlifError('INTERNAL', 'Linux Secret Service is unavailable', { cause: error })));
    child.once('close', (code) => {
      finish({ code: code ?? 1, output });
    });
    child.stdin.end(input ?? '');
  });
}

export class LinuxSecretServiceBackend implements ProjectSecretBackend {
  readonly kind = 'linux-secret-service' as const;
  readonly #command: string;
  readonly #runner: SecretToolRunner;
  #available: Promise<boolean> | undefined;

  constructor(options: { readonly command?: string; readonly runner?: SecretToolRunner } = {}) {
    this.#command = options.command ?? 'secret-tool';
    this.#runner = options.runner ?? ((args, input) => runSecretTool(this.#command, args, input));
  }

  async isAvailable(): Promise<boolean> {
    if (this.#available) return this.#available;
    this.#available = Promise.resolve().then(async () => {
      try {
        const result = await this.#runner(['--version']);
        return result.code === 0;
      } catch {
        return false;
      }
    });
    return this.#available;
  }

  async load(target: string): Promise<string | undefined> {
    const result = await this.#runner(['lookup', 'service', 'plif', 'project', target]);
    if (result.code === 1 && result.output.length === 0) return undefined;
    if (result.code !== 0) throw new PlifError('INTERNAL', 'the Linux Secret Service record could not be read');
    return result.output.replace(/\r?\n$/, '');
  }

  async save(target: string, value: string): Promise<void> {
    const result = await this.#runner(
      ['store', '--label=Plif project environment', 'service', 'plif', 'project', target],
      value,
    );
    if (result.code !== 0) throw new PlifError('INTERNAL', 'the Linux Secret Service record could not be saved');
  }

  async clear(target: string): Promise<void> {
    const result = await this.#runner(['clear', 'service', 'plif', 'project', target]);
    if (result.code !== 0 && result.code !== 1) throw new PlifError('INTERNAL', 'the Linux Secret Service record could not be removed');
  }
}

interface KoffiApi {
  load(path: string): NativeLibrary;
  struct(name: string, fields: Record<string, unknown>): unknown;
  decode(value: unknown, type: unknown, length?: number): unknown;
  as(value: unknown, type: unknown): unknown;
}

interface NativeLibrary {
  func(definition: string): NativeFunction;
}

type NativeFunction = (...args: any[]) => any;

interface WinCredentialBindings {
  readonly koffi: KoffiApi;
  readonly advapi32: NativeLibrary;
  readonly kernel32: { GetLastError(): number };
}

interface CredentialRecord {
  readonly CredentialBlobSize: number;
  readonly CredentialBlob: unknown;
}

export class WindowsCredentialManagerBackend implements ProjectSecretBackend {
  readonly kind = 'windows-credential-manager' as const;
  #bindings: Promise<WinCredentialBindings | null> | undefined;
  #functions: Promise<{
    readonly read: NativeFunction;
    readonly write: NativeFunction;
    readonly remove: NativeFunction;
    readonly free: NativeFunction;
    readonly credential: unknown;
    readonly koffi: KoffiApi;
  } | null> | undefined;

  async isAvailable(): Promise<boolean> {
    return (await this.#getFunctions()) !== null;
  }

  async load(target: string): Promise<string | undefined> {
    const functions = await this.#getFunctions();
    if (!functions) throw new PlifError('INTERNAL', 'Windows Credential Manager is unavailable');
    const output: unknown[] = [null];
    const ok = functions.read(target, 1, 0, output);
    if (!ok) {
      const code = await this.#lastError();
      if (code === CREDENTIAL_NOT_FOUND) return undefined;
      throw new PlifError('INTERNAL', 'the Windows Credential Manager record could not be read');
    }
    const pointer = output[0];
    if (!pointer) throw new PlifError('INTERNAL', 'the Windows Credential Manager returned an empty record');
    try {
      const record = pointer as CredentialRecord;
      const bytes = functions.koffi.decode(record.CredentialBlob, 'uint8_t', record.CredentialBlobSize);
      return Buffer.from(bytes as Uint8Array).toString('utf8');
    } finally {
      functions.free(pointer);
    }
  }

  async save(target: string, value: string): Promise<void> {
    const functions = await this.#getFunctions();
    if (!functions) throw new PlifError('INTERNAL', 'Windows Credential Manager is unavailable');
    const blob = Buffer.from(value, 'utf8');
    const record = {
      Flags: 0,
      Type: 1,
      TargetName: target,
      Comment: null,
      LastWritten: { dwLowDateTime: 0, dwHighDateTime: 0 },
      CredentialBlobSize: blob.length,
      CredentialBlob: blob,
      Persist: 2,
      AttributeCount: 0,
      Attributes: null,
      TargetAlias: null,
      UserName: 'plif',
    };
    if (!functions.write(record, 0)) {
      throw new PlifError('INTERNAL', 'the Windows Credential Manager record could not be saved');
    }
  }

  async clear(target: string): Promise<void> {
    const functions = await this.#getFunctions();
    if (!functions) throw new PlifError('INTERNAL', 'Windows Credential Manager is unavailable');
    if (functions.remove(target, 1, 0)) return;
    const code = await this.#lastError();
    if (code !== CREDENTIAL_NOT_FOUND) throw new PlifError('INTERNAL', 'the Windows Credential Manager record could not be removed');
  }

  async #lastError(): Promise<number> {
    const bindings = await this.#bindings;
    return bindings?.kernel32.GetLastError() ?? 1;
  }

  async #getFunctions(): Promise<{
    readonly read: NativeFunction;
    readonly write: NativeFunction;
    readonly remove: NativeFunction;
    readonly free: NativeFunction;
    readonly credential: unknown;
    readonly koffi: KoffiApi;
  } | null> {
    if (this.#functions) return this.#functions;
    this.#functions = Promise.resolve().then(async () => {
      const bindings = await this.#getBindings();
      if (!bindings) return null;
      const fileTime = bindings.koffi.struct('PLIF_FILETIME', {
        dwLowDateTime: 'uint32_t',
        dwHighDateTime: 'uint32_t',
      });
      const credential = bindings.koffi.struct('PLIF_CREDENTIALW', {
        Flags: 'uint32_t',
        Type: 'uint32_t',
        TargetName: 'char16_t *',
        Comment: 'char16_t *',
        LastWritten: fileTime,
        CredentialBlobSize: 'uint32_t',
        CredentialBlob: 'uint8_t *',
        Persist: 'uint32_t',
        AttributeCount: 'uint32_t',
        Attributes: 'void *',
        TargetAlias: 'char16_t *',
        UserName: 'char16_t *',
      });
      const fn = bindings.advapi32.func.bind(bindings.advapi32);
      return {
        read: fn('int __stdcall CredReadW(const char16_t *, uint32_t, uint32_t, _Out_ PLIF_CREDENTIALW **)'),
        write: fn('int __stdcall CredWriteW(PLIF_CREDENTIALW *, uint32_t)'),
        remove: fn('int __stdcall CredDeleteW(const char16_t *, uint32_t, uint32_t)'),
        free: fn('void __stdcall CredFree(void *)'),
        credential,
        koffi: bindings.koffi,
      };
    });
    return this.#functions;
  }

  async #getBindings(): Promise<WinCredentialBindings | null> {
    if (this.#bindings) return this.#bindings;
    this.#bindings = Promise.resolve().then(async () => {
      if (process.platform !== 'win32') return null;
      const loaded = await loadWindowsCredentialManager();
      if (!loaded) return null;
      return loaded as unknown as WinCredentialBindings;
    });
    return this.#bindings;
  }
}

export function platformProjectSecretBackend(): ProjectSecretBackend | null {
  if (process.platform === 'win32') return new WindowsCredentialManagerBackend();
  if (process.platform === 'linux') return new LinuxSecretServiceBackend();
  return null;
}

export function secretToolAvailable(): boolean {
  if (process.platform !== 'linux') return false;
  const result = spawnSync('secret-tool', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 5_000,
    windowsHide: true,
  });
  return result.status === 0 && result.error === undefined;
}
