/**
 * Windows DPAPI, called directly instead of through PowerShell.
 *
 * The credential store used to shell out to `powershell.exe` for every
 * protect/unprotect. On this machine that costs ~480ms per call — paid once on
 * every startup that resolves a stored model key, and once *per record* when
 * the model menu lists the names it knows. That was the largest single item in
 * Plif's startup, and it also made key handling fragile: a slow or blocked
 * PowerShell surfaced as "the key failed".
 *
 * `CryptProtectData`/`CryptUnprotectData` are the same primitives PowerShell's
 * `ConvertFrom-SecureString`/`ConvertTo-SecureString` use — same user scope, no
 * extra entropy, and the same on-disk shape: hex over the DPAPI blob of the
 * UTF-16LE plaintext. Records written by either path are readable by the other,
 * which is what lets `runWindowsDpapi` fall back to the PowerShell helper when
 * the FFI binding is unavailable.
 *
 * Cost after the change: ~1ms per call, plus a one-time ~150ms koffi load that
 * only a session actually touching a secret ever pays.
 */

import { PlifError } from '../errors.js';

interface DataBlob {
  cbData: number;
  pbData: Buffer | null;
}

interface Bindings {
  readonly protect: (...args: unknown[]) => number;
  readonly unprotect: (...args: unknown[]) => number;
  readonly free: (handle: unknown) => unknown;
  readonly decode: (pointer: unknown, type: unknown) => ArrayLike<number>;
  readonly blobArray: (length: number) => unknown;
}

let bindings: Promise<Bindings | null> | undefined;

/**
 * Bind crypt32 once. A failure here is not fatal anywhere: every caller falls
 * back to the PowerShell helper, so an environment without a usable koffi
 * build keeps working, only slower.
 */
async function load(): Promise<Bindings | null> {
  bindings ??= (async (): Promise<Bindings | null> => {
    if (process.platform !== 'win32') return null;
    try {
      const koffi = (await import('koffi')).default as unknown as {
        struct(name: string, fields: Record<string, string>): unknown;
        load(name: string): { func(signature: string): (...args: unknown[]) => number };
        array(type: string, length: number, kind: string): unknown;
        decode(pointer: unknown, type: unknown): ArrayLike<number>;
      };
      koffi.struct('PlifDataBlob', { cbData: 'uint32', pbData: 'uint8*' });
      const crypt32 = koffi.load('crypt32.dll');
      const kernel32 = koffi.load('kernel32.dll');
      const signature = (name: string): string =>
        `int __stdcall ${name}(PlifDataBlob *in, void *description, PlifDataBlob *entropy, ` +
        'void *reserved, void *prompt, uint32 flags, _Out_ PlifDataBlob *out)';
      return {
        protect: crypt32.func(signature('CryptProtectData')),
        unprotect: crypt32.func(signature('CryptUnprotectData')),
        free: kernel32.func('void* __stdcall LocalFree(void *handle)'),
        decode: (pointer, type) => koffi.decode(pointer, type),
        blobArray: (length) => koffi.array('uint8', length, 'Array'),
      };
    } catch {
      return null;
    }
  })();
  return await bindings;
}

/** True when the in-process binding is usable; PowerShell is the alternative. */
export async function nativeDpapiAvailable(): Promise<boolean> {
  return (await load()) !== null;
}

function transform(api: Bindings, fn: (...args: unknown[]) => number, input: Buffer): Buffer {
  const out: DataBlob = { cbData: 0, pbData: null };
  const ok = fn({ cbData: input.length, pbData: input }, null, null, null, null, 0, out);
  if (!ok || out.pbData === null) {
    throw new PlifError('INTERNAL', 'Windows DPAPI rejected the record');
  }
  try {
    return Buffer.from(api.decode(out.pbData, api.blobArray(out.cbData)));
  } finally {
    api.free(out.pbData);
  }
}

/**
 * Protect or unprotect with the current user's DPAPI key, in the same wire
 * shape PowerShell's SecureString cmdlets use. Returns null — rather than
 * throwing — when no binding is available, so the caller can fall back.
 */
export async function nativeWindowsDpapi(
  mode: 'protect' | 'unprotect',
  input: string,
): Promise<string | null> {
  const api = await load();
  if (!api) return null;
  if (mode === 'protect') {
    const blob = transform(api, api.protect, Buffer.from(input, 'utf16le'));
    // Uppercase to match what ConvertFrom-SecureString writes, so records are
    // byte-identical whichever path produced them.
    return blob.toString('hex').toUpperCase();
  }
  const hex = input.trim();
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new PlifError('INTERNAL', 'the credential record is not a DPAPI blob');
  }
  return transform(api, api.unprotect, Buffer.from(hex, 'hex')).toString('utf16le');
}
