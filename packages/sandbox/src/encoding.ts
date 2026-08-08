/**
 * Decoding what a child process actually wrote.
 *
 * Node hands you bytes and assumes UTF-8. On Windows that assumption is wrong
 * for a large family of programs: when stdout is a pipe rather than a console,
 * the built-in tools (`ping`, `dir`, `cmd` itself, most of System32) emit text
 * in the **OEM codepage** — 850 in Western European locales, 437 in US, 932 in
 * Japanese — regardless of what `chcp` reports for the console.
 *
 * Decoding those bytes as UTF-8 turns `número` into `n?mero`. That is not a
 * cosmetic problem here: the same string goes into the audit log and, later,
 * into the agent's context. An agent reasoning over corrupted tool output makes
 * corrupted decisions, and a mangled path in a log is a path you cannot grep
 * for.
 *
 * `TextDecoder` cannot help — the WHATWG encoding standard deliberately omits
 * the IBM/OEM codepages. But `MultiByteToWideChar` in kernel32 handles every
 * codepage Windows knows, including the multi-byte CJK ones, and we already
 * have kernel32 bound for Job Objects. No new dependency.
 */

import { loadWin32 } from './win32/ffi.js';

const CP_UTF8 = 65001;

export interface Decoder {
  /** Decode a complete buffer to text. */
  (bytes: Buffer): string;
}

/** UTF-8, for every platform that is not doing anything unusual. */
const utf8Decoder: Decoder = (bytes) => bytes.toString('utf8');

let cached: Decoder | undefined;
let describedAs = 'utf-8';

/**
 * Build the decoder appropriate to this host.
 *
 * Resolved once and cached: the codepage cannot change under a running process,
 * and doing an FFI call per output chunk would be absurd.
 */
export async function consoleDecoder(): Promise<Decoder> {
  if (cached) return cached;

  if (process.platform !== 'win32') {
    cached = utf8Decoder;
    return cached;
  }

  const bindings = await loadWin32();
  if (!bindings) {
    // No FFI: UTF-8 is the best guess available, and the capability report
    // already tells the user the Windows integration is degraded.
    cached = utf8Decoder;
    return cached;
  }

  const { kernel32 } = bindings;
  let codepage: number;
  try {
    codepage = kernel32.GetOEMCP();
  } catch {
    cached = utf8Decoder;
    return cached;
  }

  if (!codepage || codepage === CP_UTF8) {
    describedAs = 'utf-8 (OEM codepage is already 65001)';
    cached = utf8Decoder;
    return cached;
  }

  describedAs = `OEM codepage ${codepage}, UTF-8 when the bytes say so`;
  cached = (bytes: Buffer): string => {
    if (bytes.length === 0) return '';

    // Not every program on a Windows box is a Windows program. Git for Windows
    // tools, node, python and anything cross-compiled write UTF-8 to a pipe,
    // while System32 writes OEM — and there is no way to ask which one ran.
    // Decoding a `git log` as CP850 corrupts exactly the author names that
    // needed the high bytes, which is the same class of damage decoding `dir`
    // as UTF-8 does. The bytes themselves settle it: UTF-8 is a self-validating
    // encoding, so a buffer that parses strictly as UTF-8 and carries at least
    // one multi-byte sequence almost certainly is UTF-8. Pure ASCII decodes
    // identically either way, so it takes the fast path and never reaches here.
    if (looksUtf8(bytes)) return bytes.toString('utf8');

    try {
      // First call sizes the output, second fills it. Asking for the size is
      // not optional: a multi-byte codepage produces fewer UTF-16 units than
      // input bytes, and a fixed-size guess either truncates or over-allocates.
      const chars = kernel32.MultiByteToWideChar(codepage, 0, bytes, bytes.length, null, 0);
      if (chars <= 0) return bytes.toString('utf8');

      const wide = Buffer.alloc(chars * 2);
      const written = kernel32.MultiByteToWideChar(codepage, 0, bytes, bytes.length, wide, chars);
      if (written <= 0) return bytes.toString('utf8');

      return wide.toString('utf16le', 0, written * 2);
    } catch {
      // Never let a decoding failure lose the output entirely — mojibake is
      // bad, a swallowed error message is worse.
      return bytes.toString('utf8');
    }
  };
  return cached;
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Does this buffer carry non-ASCII bytes that are valid UTF-8?
 *
 * False for pure ASCII: both candidate encodings agree there, so claiming
 * "this is UTF-8" would be a guess dressed as a decision, and the OEM path
 * produces the same characters anyway.
 */
function looksUtf8(bytes: Buffer): boolean {
  let high = false;
  for (const byte of bytes) {
    if (byte >= 0x80) {
      high = true;
      break;
    }
  }
  if (!high) return false;
  try {
    strictUtf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** How output is being decoded, for the sandbox capability report. */
export function decoderDescription(): string {
  return describedAs;
}
