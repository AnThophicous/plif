/**
 * Output collection, shared by every backend.
 *
 * Three rules that every backend must obey identically, which is why this is
 * one module rather than a copy per backend:
 *
 *   1. Output is capped. A command that prints a gigabyte must not take the
 *      agent's process down with it.
 *   2. What is streamed live is exactly what ends up in the final result.
 *      If the live view showed a line that the captured output later omits,
 *      the developer and the agent would be reading different transcripts of
 *      the same command — and only one of them would be right.
 *   3. Bytes are decoded with the host's actual console encoding, not assumed
 *      to be UTF-8. See `encoding.ts` for why that matters on Windows.
 */

import type { Decoder } from './encoding.js';

const EMPTY = Buffer.alloc(0);

export class BoundedBuffer {
  #chunks: Buffer[] = [];
  #size = 0;
  readonly #limit: number;
  readonly #decode: Decoder;

  /** True once anything has been dropped for exceeding the ceiling. */
  truncated = false;

  constructor(limit: number, decode: Decoder) {
    this.#limit = limit;
    this.#decode = decode;
  }

  /** Append up to the ceiling, and return exactly the slice that was kept. */
  push(chunk: Buffer): Buffer {
    if (this.#size >= this.#limit) {
      this.truncated = true;
      return EMPTY;
    }
    const room = this.#limit - this.#size;
    const kept = chunk.length <= room ? chunk : chunk.subarray(0, room);
    if (kept.length < chunk.length) this.truncated = true;
    this.#chunks.push(kept);
    this.#size += kept.length;
    return kept;
  }

  /**
   * The authoritative transcript.
   *
   * Decodes the whole accumulated buffer at once rather than concatenating
   * per-chunk decodes, so a multi-byte character split across a pipe read is
   * reassembled correctly.
   */
  text(): string {
    return this.#decode(Buffer.concat(this.#chunks));
  }

  get size(): number {
    return this.#size;
  }
}

/**
 * Wire a child's stdout and stderr into two buffers, relaying whatever is kept.
 *
 * Live chunks are decoded individually, which means a multi-byte character
 * landing on a chunk boundary can flicker as a replacement character in the
 * streaming view. That is deliberate: the live view is best-effort and is
 * superseded moments later by `text()`, which decodes the whole buffer and is
 * exact. Holding back a partial sequence to make the live view perfect would
 * mean withholding output from a developer watching a slow command — the wrong
 * trade for the one view that is already known to be provisional.
 */
export function captureOutput(
  child: { stdout?: NodeJS.ReadableStream | null; stderr?: NodeJS.ReadableStream | null },
  maxOutputBytes: number,
  decode: Decoder,
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void,
): { stdout: BoundedBuffer; stderr: BoundedBuffer; truncated: () => boolean } {
  const stdout = new BoundedBuffer(maxOutputBytes, decode);
  const stderr = new BoundedBuffer(maxOutputBytes, decode);

  const relay =
    (stream: 'stdout' | 'stderr', buffer: BoundedBuffer) =>
    (chunk: Buffer): void => {
      const kept = buffer.push(chunk);
      if (kept.length > 0) onOutput?.(stream, decode(kept));
    };

  child.stdout?.on('data', relay('stdout', stdout));
  child.stderr?.on('data', relay('stderr', stderr));

  return { stdout, stderr, truncated: () => stdout.truncated || stderr.truncated };
}
